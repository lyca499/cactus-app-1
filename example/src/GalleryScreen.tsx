import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  Image,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Alert,
  ActivityIndicator,
  NativeModules,
  TextInput,
  Keyboard,
} from 'react-native';

import RNFS from 'react-native-fs';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { backendApi } from './backendApi';

// --- CONSTANTS ---
const { width } = Dimensions.get('window');
const NUM_COLUMNS = 4;
const ITEM_SIZE = width / NUM_COLUMNS;
const SCREENSHOT_PATH = `${RNFS.ExternalStorageDirectoryPath}/Pictures/test`;
const STORAGE_KEY_PREFIX = '@img_summary_';

const { FileManager } = NativeModules;

interface GalleryItem {
  id: string;
  name: string;
  uri: string;
  date: string;
}

// Path remains based on user confirmation
const SCREENSHOT_PATH = `${RNFS.ExternalStorageDirectoryPath}/Pictures/Screenshots`;

// --- NEW COMPONENT: Chatbox ---
interface ChatboxProps {
  onSend: (text: string) => Promise<void> | void;
  disabled?: boolean;
}

const Chatbox: React.FC<ChatboxProps> = ({ onSend, disabled }) => {
  const [inputText, setInputText] = useState('');

  // Custom hook to track keyboard state (similar to useKeyboard in community libs)
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => {
      // Set the height of the keyboard
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return (
    // The main container for the chatbox, lifted by keyboard height on show
    <View style={[styles.chatboxContainer, { marginBottom: keyboardHeight }]}>
      <View style={styles.chatboxInputArea}>
        <TextInput
          style={styles.chatboxInput}
          placeholder="Type a message..."
          placeholderTextColor="#999"
          value={inputText}
          onChangeText={setInputText}
          autoCorrect={false}
          onSubmitEditing={async () => {
            const text = inputText.trim();
            if (!text || disabled) return;
            await onSend(text);
            setInputText('');
          }}
        />
        <TouchableOpacity
          style={styles.sendButton}
          onPress={async () => {
            const text = inputText.trim();
            if (!text || disabled) return;
            await onSend(text);
            setInputText('');
          }}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
// --- END Chatbox Component ---

const GalleryScreen = () => {
  // --- AI SETUP ---
  const cactusLM = useCactusLM({ model: 'lfm2-vl-450m' });
  const [_isAiReady, _setIsAiReady] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<GalleryItem[]>([]);
  const [currentProcessingFile, setCurrentProcessingFile] = useState<
    string | null
  >(null);

  // --- STANDARD STATE ---
  const [files, setFiles] = useState<GalleryItem[]>([]);
  const [_filteredFiles, setFilteredFiles] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [selectedFile, setSelectedFile] = useState<GalleryItem | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [checkingBackend, setCheckingBackend] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  const handleOpenFolder = () => {
    if (Platform.OS === 'android' && FileManager?.openScreenshotsFolder) {
      FileManager.openScreenshotsFolder();
    } else {
      Alert.alert('Unsupported', 'This function is only available on Android.');
    }
  };

  // Permission Logic remains the same (Correct for Android 13+)
  const requestStoragePermission = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setPermissionGranted(true);
      return;
    }
    try {
      let permissionToRequest =
        Platform.Version >= 33
          ? PERMISSIONS.ANDROID.READ_MEDIA_IMAGES
          : PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;

      const result = await request(permissionToRequest);
      if (result === RESULTS.GRANTED || result === RESULTS.LIMITED) {
        setPermissionGranted(true);
      } else {
        setPermissionGranted(false);
      }
    } catch (err) {
      console.warn(err);
      setPermissionGranted(false);
    }
  }, []);

  const loadFiles = useCallback(async () => {
    if (!permissionGranted) return;
    setLoading(true);

    try {
      const dirExists = await RNFS.exists(SCREENSHOT_PATH);
      if (!dirExists) {
        setFiles([]);
        return;
      }

      const items = await RNFS.readDir(SCREENSHOT_PATH);

      // 1. Get basic file info
      const rawFiles = items
        .filter(
          (item) => item.isFile() && item.name.toLowerCase().endsWith('.png')
        )
        .sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0));

      // 2. Check Database (AsyncStorage) for existing summaries
      const processedFiles: GalleryItem[] = await Promise.all(
        rawFiles.map(async (item) => {
          const savedSummary = await AsyncStorage.getItem(
            STORAGE_KEY_PREFIX + item.name
          );
          return {
            id: item.name,
            name: item.name,
            uri: `file://${item.path}`,
            date: item.mtime ? item.mtime.toLocaleDateString() : 'Unknown',
            summary: savedSummary || undefined,
          };
        })
      );

      setFiles(processedFiles);
      setFilteredFiles(processedFiles);

      // 3. Identify files that need AI processing (missing summary)
      const needsProcessing = processedFiles.filter((f) => !f.summary);
      if (needsProcessing.length > 0) {
        setProcessingQueue(needsProcessing);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [permissionGranted]);

  useEffect(() => {
    requestStoragePermission();
  }, [requestStoragePermission]);
  useEffect(() => {
    if (permissionGranted) loadFiles();
  }, [permissionGranted, loadFiles]);

  // --- 4. AI PROCESSING LOOP ---
  // This effect runs whenever the queue changes or AI readiness changes
  useEffect(() => {
    const processQueue = async () => {
      // Conditions to stop: No queue or currently busy
      if (
        processingQueue.length === 0 ||
        currentProcessingFile ||
        cactusLM.isGenerating
      )
        return;

      const fileToProcess = processingQueue[0];
      setCurrentProcessingFile(fileToProcess.name);

      try {
        console.log(`Analyzing: ${fileToProcess.name}`);

        // A. Construct the Prompt
        const messages: Message[] = [
          {
            role: 'system',
            content:
              'You are a database indexer. Identify the company/app name (e.g. Amazon, Google) and list key visible UI fields (e.g. Username, Password, Submit). Output ONLY a simple keyword string.',
          },
          {
            role: 'user',
            content: 'Analyze this screenshot.',
            images: [fileToProcess.uri],
          },
        ];

        // B. Run AI
        const result = await cactusLM.complete({ messages });

        const summaryText = result.response.trim();
        console.log(`Generated Summary: ${summaryText}`);

        // C. Save to Database (AsyncStorage)
        await AsyncStorage.setItem(
          STORAGE_KEY_PREFIX + fileToProcess.name,
          summaryText
        );

        // D. Update State (Update specific item in list)
        setFiles((prev) =>
          prev.map((item) =>
            item.id === fileToProcess.id
              ? { ...item, summary: summaryText }
              : item
          )
        );
      } catch (error) {
        console.error('AI Analysis failed:', error);
      } finally {
        // E. Move to next item
        setCurrentProcessingFile(null);
        setProcessingQueue((prev) => prev.slice(1)); // Remove first item
      }
    };

    processQueue();
  }, [processingQueue, currentProcessingFile, cactusLM]);

  // --- 5. SEARCH LOGIC --- (removed - searchText not defined)

  // --- RENDER HELPERS ---

  const handlePressFile = (file: GalleryItem) => setSelectedFile(file);

  const renderGalleryItem = ({ item }: { item: GalleryItem }) => (
    <TouchableOpacity
      style={styles.itemContainer}
      onPress={() => handlePressFile(item)}
    >
      <Image
        source={{ uri: item.uri }}
        style={styles.image}
        resizeMode="cover"
      />
      {/* Visual indicator if AI processed it */}
      {item.summary && <View style={styles.aiIndicator} />}
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Screenshot Gallery</Text>
      <Text style={styles.headerSubtitle}>
        {loading ? 'Loading...' : `Total Files: ${files.length}`}
      </Text>
      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            backendConnected
              ? styles.statusConnected
              : styles.statusDisconnected,
          ]}
        />
        <Text style={styles.statusTextSmall}>
          {checkingBackend
            ? 'Checking backend...'
            : backendConnected
              ? 'Backend connected'
              : 'Backend offline'}
        </Text>
      </View>
      <TouchableOpacity
        onPress={handleOpenFolder}
        style={styles.openFolderButton}
      >
        <Text style={styles.openFolderButtonText}>Open Folder in Android</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={handleSyncToBackend}
        style={[
          styles.syncButton,
          (!backendConnected || isSyncing || files.length === 0) &&
            styles.syncButtonDisabled,
        ]}
        disabled={!backendConnected || isSyncing || files.length === 0}
      >
        <Text style={styles.syncButtonText}>
          {isSyncing ? 'Syncing...' : 'Sync screenshots to backend'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderModal = () => {
    if (!selectedFile) return null;
    return (
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{selectedFile.name}</Text>
          <Image
            source={{ uri: selectedFile.uri }}
            style={styles.modalImage}
            resizeMode="contain"
          />

          <Text style={styles.modalLabel}>AI Analysis:</Text>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryText}>
              {selectedFile.summary || 'Pending analysis...'}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setSelectedFile(null)}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={styles.statusText}>Searching for screenshots...</Text>
        </View>
      );
    }

    if (!permissionGranted) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.statusText}>
            Permission is required to view screenshots.
          </Text>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={requestStoragePermission}
          >
            <Text style={styles.closeButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (files.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.statusText}>
            No PNG screenshots found in folder.
          </Text>
        </View>
      );
    }

    // UPDATED: Removed contentContainerStyle/columnWrapperStyle to eliminate gaps
    return (
      <FlatList
        data={files}
        renderItem={renderGalleryItem}
        keyExtractor={(item) => item.id}
        numColumns={NUM_COLUMNS}
        // Removed contentContainerStyle={styles.listContent}
        // Removed columnWrapperStyle={styles.columnWrapper}
      />
    );
  };

  // Check backend health once on mount
  useEffect(() => {
    const checkBackend = async () => {
      try {
        await backendApi.healthCheck();
        setBackendConnected(true);
      } catch (error) {
        console.warn('Backend health check failed:', error);
        setBackendConnected(false);
      } finally {
        setCheckingBackend(false);
      }
    };
    checkBackend();
  }, []);

  // Sync current screenshots to backend
  const handleSyncToBackend = async () => {
    if (!backendConnected) {
      Alert.alert(
        'Backend not connected',
        'Make sure the backend app is running on port 3000.'
      );
      return;
    }
    if (files.length === 0) {
      Alert.alert('No screenshots', 'There are no screenshots to sync.');
      return;
    }

    try {
      setIsSyncing(true);
      const images = files.map((file) => ({ imageUri: file.uri }));
      const result = await backendApi.processImagesBatch(images);

      Alert.alert(
        'Sync complete',
        `Processed: ${result.processed}/${result.total}\nFailed: ${result.failed}`
      );
    } catch (error) {
      Alert.alert(
        'Sync failed',
        error instanceof Error
          ? error.message
          : 'Unknown error while syncing screenshots.'
      );
    } finally {
      setIsSyncing(false);
    }
  };

  // Chat handler: send query to backend memory API
  const handleChatSend = async (text: string) => {
    if (!backendConnected) {
      Alert.alert(
        'Backend not connected',
        'Start the backend app before querying memory.'
      );
      return;
    }
    try {
      const result = await backendApi.queryMemory(text, 5);
      Alert.alert('Answer from your memories', result.answer);
    } catch (error) {
      Alert.alert(
        'Query failed',
        error instanceof Error
          ? error.message
          : 'Unknown error while querying memory.'
      );
    }
  };

  return (
    // KeyboardAvoidingView is typically used but the custom Chatbox handles lifting via marginBottom
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      <View style={styles.contentWrapper}>
        {/* Ensures FlatList takes available space */}
        {renderContent()}
      </View>
      <Chatbox onSend={handleChatSend} disabled={!backendConnected} />
      {renderModal()}
    </SafeAreaView>
  );
};

export default GalleryScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  headerSubtitle: { fontSize: 14, color: '#777', marginTop: 4 },
  openFolderButton: {
    backgroundColor: '#3498db',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 5,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  openFolderButtonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusConnected: {
    backgroundColor: '#4caf50',
  },
  statusDisconnected: {
    backgroundColor: '#f44336',
  },
  statusTextSmall: {
    fontSize: 12,
    color: '#666',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  contentWrapper: {
    flex: 1,
  },
  syncButton: {
    marginTop: 8,
    backgroundColor: '#3498db',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  syncButtonDisabled: {
    backgroundColor: '#b0c4de',
  },
  syncButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },

  // Gallery Item Styles (UPDATED)
  // Removed padding/margin styles from listContent and columnWrapper.
  itemContainer: {
    width: ITEM_SIZE,
    height: ITEM_SIZE, // Height is now the same as width
    margin: 0,
    padding: 0,
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 0, // Removed border radius
    borderWidth: 0, // Removed border
  },
  // fileName: { ... } <-- REMOVED

  // Modal Styles (Unchanged)
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  }, // Added zIndex
  modalContent: {
    width: '90%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#ccc',
    marginVertical: 15,
    borderRadius: 8,
  },
  modalDetail: { fontSize: 14, color: '#555', marginBottom: 20 },
  closeButton: {
    backgroundColor: '#000',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    marginTop: 10,
  },
  closeButtonText: { color: '#fff', fontWeight: '600' },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  statusText: {
    fontSize: 16,
    color: '#555',
    marginTop: 15,
    textAlign: 'center',
  },

  // --- NEW Chatbox Styles ---
  chatboxContainer: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    // The `marginBottom` property is dynamically set to `keyboardHeight` in the component
  },
  chatboxInputArea: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
  },
  chatboxInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 15,
    marginRight: 10,
    fontSize: 16,
    color: '#333',
  },
  sendButton: {
    backgroundColor: '#3498db',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
