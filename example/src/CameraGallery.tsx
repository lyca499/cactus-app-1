import { useState, useEffect } from 'react';
import { FlatList, Image, StyleSheet } from 'react-native';

const API_BASE = 'http://localhost:8067/api';

// 1. Define the type/interface for your image data
interface ImageItem {
  name: string; // Used for keyExtractor
  url: string; // Used for Image source
  // Add any other properties your API returns here (e.g., 'id', 'timestamp')
}

function CameraGallery() {
  // 2. Explicitly type the state as an array of ImageItem
  const [images, setImages] = useState<ImageItem[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/images`)
      .then((res) => res.json())
      .then((data: { images: ImageItem[] }) => {
        // Optional: Type the incoming data as well
        setImages(data.images);
      });
  }, []);

  return (
    <FlatList
      data={images}
      // TypeScript now knows 'item' is of type ImageItem, which has 'name'
      keyExtractor={(item) => item.name}
      renderItem={({ item }) => (
        // TypeScript now knows 'item' is of type ImageItem, which has 'url'
        <Image source={{ uri: item.url }} style={styles.image} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    width: 200,
    height: 200,
  },
});

export default CameraGallery;
