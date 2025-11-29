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
  TextInput, // <-- NEW
  Keyboard,  // <-- NEW
  KeyboardAvoidingView, // <-- NEW
} from 'react-native';

import RNFS from 'react-native-fs';
import { request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';

// --- CONSTANTS ---
const { width, height } = Dimensions.get('window'); // Added height
const NUM_COLUMNS = 4;
// PADDING and ITEM_MARGIN are set to 0 to remove gaps, but kept for clarity
const PADDING = 0; 
const ITEM_MARGIN = 0;
// Calculate item size to fill the width exactly
const ITEM_SIZE = width / NUM_COLUMNS; 

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
const Chatbox = () => {
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
          onSubmitEditing={() => {
             // Basic action for sending message
             console.log('Sending message:', inputText);
             setInputText('');
          }}
        />
        <TouchableOpacity 
          style={styles.sendButton} 
          onPress={() => {
             console.log('Sending message:', inputText);
             setInputText('');
          }}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
// --- END Chatbox Component ---


const GalleryScreen = () => {
  const [files, setFiles] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [selectedFile, setSelectedFile] = useState<GalleryItem | null>(null);

  const handleOpenFolder = () => {
    if (Platform.OS === 'android' && FileManager?.openScreenshotsFolder) {
      FileManager.openScreenshotsFolder();
    } else {
      Alert.alert("Unsupported", "This function is only available on Android.");
    }
  };

  // Permission Logic remains the same (Correct for Android 13+)
  const requestStoragePermission = useCallback(async () => {
    // ... (omitted for brevity, no changes here) ...
    if (Platform.OS !== 'android') {
        setPermissionGranted(true);
        return;
    }

    try {
        let permissionToRequest;
        
        if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
            permissionToRequest = PERMISSIONS.ANDROID.READ_MEDIA_IMAGES;
        } else {
            permissionToRequest = PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
        }

        const result = await request(permissionToRequest);

        if (result === RESULTS.GRANTED || result === RESULTS.LIMITED) {
            setPermissionGranted(true);
        } else if (result === RESULTS.DENIED || result === RESULTS.BLOCKED) {
            setPermissionGranted(false);
            
            Alert.alert(
                'Permission Required',
                'Please grant access to Photos/Images in settings to view screenshots.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Open Settings', onPress: openSettings },
                ],
                { cancelable: false }
            );
        }
    } catch (err) {
        console.warn('Permission request failed:', err);
        setPermissionGranted(false);
    }
  }, []);


  // loadFiles Logic remains the same
  const loadFiles = useCallback(async () => {
    if (!permissionGranted) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const dirExists = await RNFS.exists(SCREENSHOT_PATH);
      if (!dirExists) {
        console.log(`Screenshot directory not found: ${SCREENSHOT_PATH}`);
        setFiles([]);
        return;
      }

      const items = await RNFS.readDir(SCREENSHOT_PATH);

      const imageFiles: GalleryItem[] = items
        .filter(item => item.isFile() && item.name.toLowerCase().endsWith('.png'))
        .sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0))
        .map((item) => ({
          id: item.name,
          name: item.name,
          uri: `file://${item.path}`,
          date: item.mtime ? item.mtime.toLocaleDateString() : 'Unknown Date',
        }));

      setFiles(imageFiles);
    } catch (e) {
      console.error('Failed to read files:', e);
      Alert.alert('Error', 'Could not read the screenshot folder.');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [permissionGranted]);

  useEffect(() => {
    requestStoragePermission();
  }, [requestStoragePermission]);

  useEffect(() => {
    if (permissionGranted) {
      loadFiles();
    } else {
      setLoading(false);
    }
  }, [permissionGranted, loadFiles]);

  // --- Render Functions ---

  const handlePressFile = (file: GalleryItem) => {
    setSelectedFile(file);
  };

  // UPDATED: Removed margin and file name text
  const renderGalleryItem = ({ item }: { item: GalleryItem }) => (
    <TouchableOpacity
      style={styles.itemContainer}
      onPress={() => handlePressFile(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.uri }}
        // The image style now ensures it fills the item container entirely
        style={styles.image} 
        resizeMode="cover"
      />
      {/* <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text> <-- REMOVED */}
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Screenshot Gallery</Text>
      <Text style={styles.headerSubtitle}>
        {loading ? 'Loading...' : `Total Files: ${files.length}`}
      </Text>
      <TouchableOpacity onPress={handleOpenFolder} style={styles.openFolderButton}>
        <Text style={styles.openFolderButtonText}>Open Folder in Android</Text>
      </TouchableOpacity>
    </View>
  );

  const renderModal = () => {
    // ... (omitted for brevity, no changes here) ...
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
                <Text style={styles.modalDetail}>Captured on: {selectedFile.date}</Text>
                <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedFile(null)}>
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
          <Text style={styles.statusText}>Permission is required to view screenshots.</Text>
          <TouchableOpacity style={styles.closeButton} onPress={requestStoragePermission}>
            <Text style={styles.closeButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (files.length === 0) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.statusText}>No PNG screenshots found in folder.</Text>
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
  }

  return (
    // KeyboardAvoidingView is typically used but the custom Chatbox handles lifting via marginBottom
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      <View style={{flex: 1}}> {/* Ensures FlatList takes available space */}
        {renderContent()}
      </View>
      <Chatbox /> {/* <-- NEW */}
      {renderModal()}
    </SafeAreaView>
  );
};

export default GalleryScreen;

// --- UPDATED STYLES ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fff' },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  headerSubtitle: { fontSize: 14, color: '#777', marginTop: 4 },
  openFolderButton: { backgroundColor: '#3498db', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 5, marginTop: 10, alignSelf: 'flex-start' },
  openFolderButtonText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  
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
      borderWidth: 0,  // Removed border
  },
  // fileName: { ... } <-- REMOVED

  // Modal Styles (Unchanged)
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 10 }, // Added zIndex
  modalContent: { width: '90%', backgroundColor: '#fff', borderRadius: 10, padding: 20, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
  modalImage: { width: '100%', height: 300, backgroundColor: '#ccc', marginVertical: 15, borderRadius: 8 },
  modalDetail: { fontSize: 14, color: '#555', marginBottom: 20 },
  closeButton: { backgroundColor: '#000', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6, marginTop: 10 },
  closeButtonText: { color: '#fff', fontWeight: '600' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  statusText: { fontSize: 16, color: '#555', marginTop: 15, textAlign: 'center' },
  
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