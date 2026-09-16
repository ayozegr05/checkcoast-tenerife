import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import CoastMap from './components/CoastMap';

export default function App() {
  return (
    <View style={styles.container}>
      <CoastMap />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
