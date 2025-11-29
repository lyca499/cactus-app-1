import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { request, PERMISSIONS, RESULTS, openSettings } from 'react-native-permissions';
import AsyncStorage from '@react-native-async-storage/async-storage'; // <-- NEW: The Database
import { useCactusLM, type Message } from 'cactus-react-native'; // <-- NEW: The AI

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
  summary?: string; // <-- NEW: Holds the AI generated tags
}

const GalleryScreen = () => {
  // --- AI SETUP ---
  const cactusLM = useCactusLM({ model: 'lfm2-vl-450m' });
  const [isAiReady, setIsAiReady] = useState(false);
  const [processingQueue, setProcessingQueue] = useState<GalleryItem[]>([]);
  const [currentProcessingFile, setCurrentProcessingFile] = useState<string | null>(null);

  // --- STANDARD STATE ---
  const [files, setFiles] = useState<GalleryItem[]>([]);
  const [filteredFiles, setFilteredFiles] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [selectedFile, setSelectedFile] = useState<GalleryItem | null>(null);
  
  // Search / Chat Input
  const [searchText, setSearchText] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // --- 1. INITIALIZE AI MODEL ---
  useEffect(() => {
    const initModel = async () => {
      if (!cactusLM.isDownloaded) {
        await cactusLM.download();
      }
      if (!cactusLM.isReady) { // Assuming library has isReady or similar, if not relying on init
         await cactusLM.init(); 
      }
      setIsAiReady(true);
    };
    initModel();
    
    // Cleanup
    return () => { cactusLM.stop(); };
  }, []); // Run once on mount

  // --- 2. KEYBOARD HANDLING ---
  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { showSubscription.remove(); hideSubscription.remove(); };
  }, []);

  // --- 3. PERMISSIONS & FILE LOADING ---
  const requestStoragePermission = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setPermissionGranted(true);
      return;
    }
    try {
      let permissionToRequest = Platform.Version >= 33 
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
        .filter(item => item.isFile() && item.name.toLowerCase().endsWith('.png'))
        .sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0));

      // 2. Check Database (AsyncStorage) for existing summaries
      const processedFiles: GalleryItem[] = await Promise.all(rawFiles.map(async (item) => {
        const savedSummary = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + item.name);
        return {
          id: item.name,
          name: item.name,
          uri: `file://${item.path}`,
          date: item.mtime ? item.mtime.toLocaleDateString() : 'Unknown',
          summary: savedSummary || undefined,
        };
      }));

      setFiles(processedFiles);
      setFilteredFiles(processedFiles);

      // 3. Identify files that need AI processing (missing summary)
      const needsProcessing = processedFiles.filter(f => !f.summary);
      if (needsProcessing.length > 0) {
        setProcessingQueue(needsProcessing);
      }

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [permissionGranted]);

  useEffect(() => { requestStoragePermission(); }, [requestStoragePermission]);
  useEffect(() => { if (permissionGranted) loadFiles(); }, [permissionGranted, loadFiles]);

  // --- 4. AI PROCESSING LOOP ---
  // This effect runs whenever the queue changes or AI readiness changes
  useEffect(() => {
    const processQueue = async () => {
      // Conditions to stop: No queue, AI not ready, or currently busy
      if (processingQueue.length === 0 || !isAiReady || currentProcessingFile || cactusLM.isGenerating) return;

      const fileToProcess = processingQueue[0];
      setCurrentProcessingFile(fileToProcess.name);

      try {
        console.log(`Analyzing: ${fileToProcess.name}`);
        
        // A. Construct the Prompt
        const messages: Message[] = [
          { role: 'system', content: 'You are a database indexer. Identify the company/app name (e.g. Amazon, Google) and list key visible UI fields (e.g. Username, Password, Submit). Output ONLY a simple keyword string.' },
          { role: 'user', content: 'Analyze this screenshot.', images: [fileToProcess.uri] },
        ];

        // B. Run AI
        const result = await cactusLM.complete({ messages });
        
        const summaryText = result.response.trim(); 
        console.log(`Generated Summary: ${summaryText}`);

        // C. Save to Database (AsyncStorage)
        await AsyncStorage.setItem(STORAGE_KEY_PREFIX + fileToProcess.name, summaryText);

        // D. Update State (Update specific item in list)
        setFiles(prev => prev.map(item => 
          item.id === fileToProcess.id ? { ...item, summary: summaryText } : item
        ));
        
      } catch (error) {
        console.error("AI Analysis failed:", error);
      } finally {
        // E. Move to next item
        setCurrentProcessingFile(null);
        setProcessingQueue(prev => prev.slice(1)); // Remove first item
      }
    };

    processQueue();
  }, [processingQueue, isAiReady, currentProcessingFile, cactusLM]);


  // --- 5. SEARCH LOGIC ---
  useEffect(() => {
    if (searchText === '') {
      setFilteredFiles(files);
    } else {
      const lowerSearch = searchText.toLowerCase();
      const filtered = files.filter(f => 
        (f.summary && f.summary.toLowerCase().includes(lowerSearch)) || 
        f.name.toLowerCase().includes(lowerSearch)
      );
      setFilteredFiles(filtered);
    }
  }, [searchText, files]);


  // --- RENDER HELPERS ---

  const handlePressFile = (file: GalleryItem) => setSelectedFile(file);

  const renderGalleryItem = ({ item }: { item: GalleryItem }) => (
    <TouchableOpacity style={styles.itemContainer} onPress={() => handlePressFile(item)}>
      <Image source={{ uri: item.uri }} style={styles.image} resizeMode="cover" />
      {/* Visual indicator if AI processed it */}
      {item.summary && <View style={styles.aiIndicator} />}
    </TouchableOpacity>
  );

  const renderModal = () => {
    if (!selectedFile) return null;
    return (
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{selectedFile.name}</Text>
          <Image source={{ uri: selectedFile.uri }} style={styles.modalImage} resizeMode="contain" />
          
          <Text style={styles.modalLabel}>AI Analysis:</Text>
          <View style={styles.summaryBox}>
             <Text style={styles.summaryText}>
               {selectedFile.summary || "Pending analysis..."}
             </Text>
          </View>

          <TouchableOpacity style={styles.closeButton} onPress={() => setSelectedFile(null)}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // --- RENDER MAIN ---
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gallery</Text>
        <Text style={styles.headerSubtitle}>
          {processingQueue.length > 0 
            ? `AI Analyzing: ${processingQueue.length} remaining...` 
            : `Indexed: ${files.length} files`}
        </Text>
        {loading && <ActivityIndicator size="small" color="#3498db" />}
      </View>

      {/* Grid */}
      <View style={{flex: 1}}>
        <FlatList
          data={filteredFiles}
          renderItem={renderGalleryItem}
          keyExtractor={(item) => item.id}
          numColumns={NUM_COLUMNS}
        />
      </View>

      {/* Search / Status Bar */}
      <View style={[styles.bottomBar, { marginBottom: keyboardHeight }]}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search (e.g. 'Amazon password')..."
          value={searchText}
          onChangeText={setSearchText}
          placeholderTextColor="#999"
        />
        {processingQueue.length > 0 && (
           <ActivityIndicator size="small" color="#333" style={{marginLeft: 10}}/>
        )}
      </View>

      {renderModal()}
    </SafeAreaView>
  );
};

export default GalleryScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { padding: 15, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  headerTitle: { fontSize: 22, fontWeight: 'bold' },
  headerSubtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  
  itemContainer: { width: ITEM_SIZE, height: ITEM_SIZE, borderWidth: 0.5, borderColor: '#fff' },
  image: { width: '100%', height: '100%' },
  aiIndicator: { position: 'absolute', bottom: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#00ff00', borderWidth: 1, borderColor: 'white' },

  // Bottom Bar
  bottomBar: { flexDirection: 'row', padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee', alignItems: 'center' },
  searchInput: { flex: 1, height: 40, backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 15 },

  // Modal
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  modalContent: { width: '85%', backgroundColor: '#fff', borderRadius: 12, padding: 20, alignItems: 'center' },
  modalTitle: { fontSize: 14, color: '#555', marginBottom: 10 },
  modalImage: { width: '100%', height: 250, backgroundColor: '#eee', borderRadius: 8 },
  modalLabel: { alignSelf: 'flex-start', marginTop: 15, fontSize: 14, fontWeight: 'bold', color: '#333'},
  summaryBox: { width: '100%', backgroundColor: '#f9f9f9', padding: 10, borderRadius: 6, marginTop: 5, marginBottom: 15 },
  summaryText: { fontSize: 16, color: '#333', fontStyle: 'italic' },
  closeButton: { backgroundColor: '#000', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6 },
  closeButtonText: { color: '#fff', fontWeight: 'bold' },
});