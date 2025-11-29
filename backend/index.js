/**
 * React Native Backend Server
 *
 * This backend uses Cactus SDK directly since it's React Native!
 *
 * import { CactusLM } from 'cactus-react-native'; ✅ Works!
 */

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
