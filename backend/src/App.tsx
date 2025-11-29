/**
 * React Native Backend App
 *
 * This app runs as a backend server using Cactus SDK directly.
 * Since it's React Native, we can use:
 *
 * import { CactusLM } from 'cactus-react-native';
 *
 * ✅ This works because we're in React Native!
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { startServer } from './server/server-simple';

const App = () => {
  const [status, setStatus] = useState('Initializing...');
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  useEffect(() => {
    const initialize = async () => {
      try {
        setStatus('Starting backend server...');

        // Start the HTTP server
        const url = await startServer();
        setServerUrl(url);
        setStatus('✅ Backend server running!');
      } catch (error) {
        console.error('Failed to start server:', error);
        setStatus(
          `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    };

    initialize();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Cactus Memory Backend</Text>
      <Text style={styles.subtitle}>React Native Backend using Cactus SDK</Text>
      <Text style={styles.status}>{status}</Text>
      {serverUrl && (
        <View style={styles.info}>
          <Text style={styles.infoText}>Server URL:</Text>
          <Text style={styles.url}>{serverUrl}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
  },
  status: {
    fontSize: 18,
    marginBottom: 16,
  },
  info: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  url: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
});

export default App;
