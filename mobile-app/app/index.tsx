import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useFonts, Ubuntu_400Regular, Ubuntu_500Medium } from '@expo-google-fonts/ubuntu';
import { SourceSerifPro_700Bold } from '@expo-google-fonts/source-serif-pro';

export default function SplashScreen() {
  const router = useRouter();
  const [fadeAnim] = useState(new Animated.Value(0));

  let [fontsLoaded] = useFonts({
    Ubuntu_400Regular,
    Ubuntu_500Medium,
    SourceSerifPro_700Bold,
  });

  useEffect(() => {
    if (!fontsLoaded) return;

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();

    const checkAuth = async () => {
      const token = await AsyncStorage.getItem('userToken');
      setTimeout(() => {
        if (token) {
          router.replace('/(tabs)');
        } else {
          router.replace('/auth');
        }
      }, 2500); 
    };

    checkAuth();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <Image 
          source={require('../assets/images/cardia_heart.png')} 
          style={styles.logo} 
          resizeMode="contain"
        />
        <Text style={styles.title}>Cardia</Text>
        <Text style={styles.subtitle}>Your vital health companion.</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF5F5', 
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logo: {
    width: 240,
    height: 240,
    marginBottom: 20,
  },
  title: {
    fontFamily: 'SourceSerifPro_700Bold',
    fontSize: 48,
    color: '#D84361',
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'Ubuntu_400Regular',
    fontSize: 18,
    color: '#8A6D72', 
  },
});