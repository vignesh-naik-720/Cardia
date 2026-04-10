import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, ScrollView, TouchableOpacity, TextInput, Modal, KeyboardAvoidingView, Platform, Image, Animated, StatusBar, Dimensions } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, Ubuntu_400Regular, Ubuntu_500Medium, Ubuntu_400Regular_Italic } from '@expo-google-fonts/ubuntu';
import { SourceSerifPro_700Bold } from '@expo-google-fonts/source-serif-pro';
import { LineChart } from 'react-native-chart-kit';
import * as ImagePicker from 'expo-image-picker';

import FoodScanner from '../../components/FoodScanner';
import MelioChat from '../../components/MelioChat';

type ChatMessage = { id: string, role: 'user' | 'agent' | 'system', text: string, suggest_local?: boolean, isNew?: boolean, imageUri?: string };

const FUN_FACTS = [
  "Scan in progress... keep your finger steady over the lens.",
  "Did you know? Your heart beats about 115,000 times a day.",
  "Deep breathing instantly lowers your Baevsky stress index.",
  "Cardia is analyzing microscopic color changes in your fingertip.",
  "Almost done! Calculating your heart rate variability..."
];

const screenWidth = Dimensions.get("window").width;
const IP_ADDRESS = "192.168.1.3";

// 🚀 NEW: Helper function to parse **bold** Markdown into React Native styles
const formatMessageText = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\*\*.*?\*\*)/g);
    
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return (
                <Text key={i} style={{ fontFamily: 'Ubuntu_500Medium' }}>
                    {part.replace(/\*\*/g, '')}
                </Text>
            );
        }
        return <Text key={i}>{part}</Text>;
    });
};

const TypewriterText = ({ text, isNew }: { text: string, isNew?: boolean }) => {
    const safeText = text || "An error occurred. Please try again.";
    const [displayedText, setDisplayedText] = useState(isNew ? "" : safeText);
    
    useEffect(() => {
        if (!isNew) return;
        let i = 0;
        const timer = setInterval(() => {
            setDisplayedText(safeText.slice(0, i + 1));
            i++;
            if (i >= safeText.length) clearInterval(timer);
        }, 15);
        return () => clearInterval(timer);
    }, [safeText, isNew]);

    return (
        <Text style={{color: '#5C4E50', fontFamily: 'Ubuntu_400Regular', fontSize: 16, lineHeight: 24}}>
            {formatMessageText(displayedText)}
        </Text>
    );
};

export default function App() {
  const router = useRouter();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  
  let [fontsLoaded] = useFonts({
    Ubuntu_400Regular,
    Ubuntu_500Medium,
    Ubuntu_400Regular_Italic,
    SourceSerifPro_700Bold,
  });

  const [currentScreen, setCurrentScreen] = useState<'home' | 'scanner' | 'cloud_chat' | 'melio_chat' | 'food_scanner'>('home');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [funFactIndex, setFunFactIndex] = useState(0);

  const [userName, setUserName] = useState<string>('');
  const [scaleAnim] = useState(new Animated.Value(1));

  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [biometrics, setBiometrics] = useState<any>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  
  const [isAnytimeMode, setIsAnytimeMode] = useState(false);

  const [selectedImage, setSelectedImage] = useState<{ uri: string, base64: string } | null>(null);

  const [timeframe, setTimeframe] = useState<'7_days' | 'month'>('7_days');
  const [selectedMetric, setSelectedMetric] = useState<'Energy' | 'Stress' | 'Focus' | 'Health'>('Energy');
  const [showMetricMenu, setShowMetricMenu] = useState(false);
  
  const [trendData, setTrendData] = useState<{labels: string[], datasets: {data: number[]}[]}>({ labels: [], datasets: [] });
  const [isLoadingTrends, setIsLoadingTrends] = useState(true);

  const cameraRef = useRef<Camera>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
    
    const fetchProfile = async () => {
      try {
        const token = await AsyncStorage.getItem('userToken');
        if (token) {
          const response = await fetch(`http://${IP_ADDRESS}:8000/api/auth/profile`, { headers: { 'Authorization': `Bearer ${token}` } });
          const data = await response.json();
          if (data.full_name) setUserName(data.full_name.split(' ')[0]);
        }
      } catch (error) { console.log("Could not load user name."); }
    };
    fetchProfile();
  }, [hasPermission]);

  useEffect(() => {
    const fetchTrends = async () => {
      setIsLoadingTrends(true);
      try {
        const token = await AsyncStorage.getItem('userToken');
        if (token) {
          const response = await fetch(`http://${IP_ADDRESS}:8000/api/trends?timeframe=${timeframe}&metric=${selectedMetric.toLowerCase()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const data = await response.json();
          
          if (data.labels && data.datasets && data.datasets[0].data) {
              const realLabels: string[] = [];
              const realData: number[] = [];
              
              for (let i = 0; i < data.datasets[0].data.length; i++) {
                  const val = data.datasets[0].data[i];
                  if (val !== null && val !== undefined && val > 0) {
                      realLabels.push(data.labels[i]);
                      realData.push(val);
                  }
              }

              if (realData.length > 0) {
                  setTrendData({ labels: realLabels, datasets: [{ data: realData }] });
              } else {
                  setTrendData({ labels: [], datasets: [] }); 
              }
          }
        }
      } catch (error) {
        setTrendData({ labels: [], datasets: [] });
      } finally {
        setIsLoadingTrends(false);
      }
    };
    if (currentScreen === 'home') fetchTrends();
  }, [timeframe, selectedMetric, currentScreen]);

  useEffect(() => {
    if (chatHistory.length > 0) setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [chatHistory]);

  const getGreeting = () => {
    const hours = new Date().getHours();
    if (hours < 12) return 'Good morning';
    if (hours < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getGraphSubtitle = () => {
      switch(selectedMetric) {
          case 'Energy': return "Your blended readiness score based on HRV and Resting Heart Rate.";
          case 'Stress': return "Your physiological stress levels derived from Baevsky's Stress Index.";
          case 'Focus': return "Your parasympathetic nervous system activity indicating mental clarity.";
          case 'Health': return "Your overall cardiovascular health and recovery baseline.";
          default: return "";
      }
  };

  const handleSignOut = async () => {
    setShowProfileMenu(false);
    await AsyncStorage.removeItem('userToken');
    router.replace('/auth' as any);
  };

  const startCalibration = () => { 
      setScanError(null); 
      if (isCameraReady) setIsCalibrating(true); 
      else setScanError("Camera warming up.");
  };

  const startScan = async () => {
    if (cameraRef.current && !isRecording && isCameraReady) {
      setIsRecording(true);
      setTimeLeft(30);
      setFunFactIndex(0);
      
      if (timerRef.current) clearInterval(timerRef.current);
      
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { 
              clearInterval(timerRef.current!); 
              cameraRef.current?.stopRecording();
              return 0; 
          }
          if ((30 - prev) % 6 === 0) setFunFactIndex(f => (f + 1) % FUN_FACTS.length);
          return prev - 1;
        });
      }, 1000);

      cameraRef.current.startRecording({
        onRecordingFinished: (video) => uploadVideo(`file://${video.path}`),
        onRecordingError: (error) => { setIsRecording(false); if (timerRef.current) clearInterval(timerRef.current); }
      });
    }
  };

  const uploadVideo = async (uri: string) => {
    setIsRecording(false); setIsCalibrating(false); setIsCameraReady(false); 
    
    setIsAnytimeMode(false); 
    setCurrentScreen('cloud_chat');
    
    setChatHistory([{ id: 'polling', role: 'system', text: 'Extracting biological signals from video...' }]);

    let formData = new FormData();
    formData.append('file', { uri, name: 'scan.mp4', type: 'video/mp4' } as any);
    
    try {
      const token = await AsyncStorage.getItem('userToken');
      const response = await fetch(`http://${IP_ADDRESS}:8000/api/scan`, {
        method: 'POST', body: formData, headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();

      if (data.task_id) {
          let isPolling = true;

          const checkStatus = async () => {
              if (!isPolling) return;
              try {
                  const statusRes = await fetch(`http://${IP_ADDRESS}:8000/api/scan/status/${data.task_id}`);
                  if (!statusRes.ok) {
                      isPolling = false;
                      setScanError("Server error.");
                      return;
                  }
                  const statusData = await statusRes.json();
                  
                  if (statusData.status === 'completed') {
                      isPolling = false;
                      
                      setChatHistory(prev => [
                          ...prev.filter(m => m.id !== 'polling'),
                          { id: 'thinking', role: 'system', text: 'Analyzing your daily metrics...' }
                      ]);
                      
                      const fullBiometrics = { metrics: statusData.metrics, meta_scores: statusData.meta_scores };
                      setBiometrics(fullBiometrics); 
                      triggerInitialAgentMessage(fullBiometrics);
                  } else if (statusData.status === 'failed') {
                      isPolling = false; 
                      setChatHistory(prev => [...prev.filter(m => m.id !== 'polling'), { id: 'err', role: 'system', text: 'Scan extraction failed.' }]);
                  } else {
                      setTimeout(checkStatus, 2000);
                  }
              } catch (pollErr) {
                  isPolling = false;
              }
          };

          checkStatus();
      } else {
          setChatHistory(prev => [...prev.filter(m => m.id !== 'polling'), { id: 'err', role: 'system', text: data.error || 'Upload error.' }]);
      }
    } catch (error) { 
        setChatHistory(prev => [...prev.filter(m => m.id !== 'polling'), { id: 'err', role: 'system', text: 'Network request failed.' }]); 
    } 
  };

  const triggerInitialAgentMessage = async (metrics: any) => {
      try {
          const token = await AsyncStorage.getItem('userToken');
          const response = await fetch(`http://${IP_ADDRESS}:8000/api/chat`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ 
                  biometrics: metrics || {}, 
                  message: "I just completed my scan.", 
                  history: [],
                  context_type: "scan"
              })
          });
          
          if (!response.ok) throw new Error("Backend error");
          
          const data = await response.json();
          
          setChatHistory(prev => [
              ...prev.filter(m => m.id !== 'thinking'),
              { id: Date.now().toString(), role: 'agent', text: data.text, suggest_local: data.suggest_local_bot, isNew: true }
          ]);
      } catch (e) { 
          setChatHistory(prev => [...prev.filter(m => m.id !== 'thinking'), { id: 'err', role: 'system', text: 'Error connecting to Agent.' }]); 
      } 
  };

  const startAnytimeChat = () => {
      setIsAnytimeMode(true);
      setBiometrics(null); 
      setCurrentScreen('cloud_chat');
      
      setChatHistory([
          { 
              id: Date.now().toString(), 
              role: 'agent', 
              text: `Hi ${userName || 'there'}! I've loaded your most recent health baseline. What's on your mind today?`, 
              isNew: true 
          }
      ]);
  };

  const pickImage = async () => {
      let result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.5,
          base64: true 
      });

      if (!result.canceled && result.assets[0].base64) {
          setSelectedImage({ uri: result.assets[0].uri, base64: result.assets[0].base64 });
      }
  };

  const sendMessage = async () => {
      if (!inputText.trim() && !selectedImage) return;
      const userMsg = inputText || "Please analyze this image.";
      
      const lowerMsg = userMsg.toLowerCase().trim();
      const isSimpleMessage = 
          lowerMsg.length < 15 || 
          ['hi', 'hello', 'hey', 'morning', 'thanks', 'thank you', 'ok', 'okay', 'good', 'bye'].some(word => lowerMsg.includes(word));
          
      const loadingText = isSimpleMessage && !selectedImage
          ? 'Cardia is typing...' 
          : 'Consulting medical database & analyzing data...';
      
      const imageToUpload = selectedImage;
      setSelectedImage(null);
      
      setChatHistory(prev => [
          ...prev.map(m => ({...m, isNew: false})),
          { id: Date.now().toString(), role: 'user', text: inputText, imageUri: imageToUpload?.uri }, 
          { id: 'searching', role: 'system', text: loadingText }
      ]);
      setInputText(""); 

      const formattedHistory = chatHistory.filter(m => m.role !== 'system').map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.text }));

      try {
          const token = await AsyncStorage.getItem('userToken');
          const response = await fetch(`http://${IP_ADDRESS}:8000/api/chat`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ 
                  biometrics: biometrics || {}, 
                  message: userMsg, 
                  image_data: imageToUpload?.base64 || null, 
                  history: formattedHistory,
                  context_type: isAnytimeMode ? "anytime" : "scan" 
              })
          });
          
          if (!response.ok) throw new Error("Backend error");
          
          const data = await response.json();
          
          setChatHistory(prev => [
              ...prev.filter(m => m.id !== 'searching'),
              { id: Date.now().toString(), role: 'agent', text: data.text, suggest_local: data.suggest_local_bot, isNew: true }
          ]);
      } catch (e) { 
          setChatHistory(prev => [...prev.filter(m => m.id !== 'searching'), { id: 'err', role: 'system', text: 'Network error.' }]); 
      } 
  };

  const handleFoodChat = (foodItem: any) => {
      const autoMessage = `I just scanned a food item: "${foodItem.name}". The system marked it as "${foodItem.verdict.toUpperCase()}" with the following notes:\n\n${foodItem.detailed_guideline}\n\nKey Macros: ${foodItem.macro_1_name} (${foodItem.macro_1_amount}), ${foodItem.macro_2_name} (${foodItem.macro_2_amount}).\n\nCan you give me more specific dietary advice on this?`;
      
      setCurrentScreen('cloud_chat');
      setIsAnytimeMode(true);
      setInputText(autoMessage); 
      
      setChatHistory([
          { 
              id: Date.now().toString(), 
              role: 'agent', 
              text: `I see you are asking about the ${foodItem.name} you just scanned! I've loaded its nutritional context. Feel free to hit send, or add any specific questions you have about it!`, 
              isNew: true 
          }
      ]);
  };

  const handlePressIn = () => { Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start(); };
  const handlePressOut = () => { Animated.spring(scaleAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start(); };

  const handleBackToHome = () => {
      setCurrentScreen('home');
      setChatHistory([]);
      setInputText("");
      setSelectedImage(null);
      setIsAnytimeMode(false);
  };

  if (!hasPermission || device == null || !fontsLoaded) return <ActivityIndicator style={{flex: 1, backgroundColor: '#FFF5F5'}} color="#D84361" />;

  return (
      <View style={styles.container}>
          
          <Modal visible={showProfileMenu} transparent animationType="fade">
              <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowProfileMenu(false)}>
                  <View style={styles.dropdownMenu}>
                      <TouchableOpacity style={styles.menuItem} onPress={() => { setShowProfileMenu(false); router.push('/profile' as any); }}>
                          <Ionicons name="person-outline" size={22} color="#8A6D72" />
                          <Text style={styles.menuText}>View Profile</Text>
                      </TouchableOpacity>
                      <View style={styles.menuDivider} />
                      <TouchableOpacity style={styles.menuItem} onPress={handleSignOut}>
                          <Ionicons name="log-out-outline" size={22} color="#D84361" />
                          <Text style={[styles.menuText, {color: '#D84361'}]}>Sign Out</Text>
                      </TouchableOpacity>
                  </View>
              </TouchableOpacity>
          </Modal>

          <Modal visible={showMetricMenu} transparent animationType="fade">
              <TouchableOpacity style={styles.modalOverlayCenter} activeOpacity={1} onPress={() => setShowMetricMenu(false)}>
                  <View style={styles.metricModalCenter}>
                      <Text style={styles.metricModalTitle}>Select Graph Metric</Text>
                      {['Energy', 'Stress', 'Focus', 'Health'].map((m, idx) => (
                          <React.Fragment key={m}>
                              {idx > 0 && <View style={styles.menuDivider} />}
                              <TouchableOpacity style={styles.menuItem} onPress={() => { setSelectedMetric(m as any); setShowMetricMenu(false); }}>
                                  <Ionicons name={
                                      m === 'Energy' ? 'flash-outline' :
                                      m === 'Stress' ? 'pulse-outline' :
                                      m === 'Focus' ? 'eye-outline' : 'heart-outline'
                                  } size={22} color={selectedMetric === m ? "#D84361" : "#8A6D72"} />
                                  <Text style={[styles.menuText, selectedMetric === m && {color: '#D84361'}]}>{m} Trend</Text>
                              </TouchableOpacity>
                          </React.Fragment>
                      ))}
                  </View>
              </TouchableOpacity>
          </Modal>

          {currentScreen === 'home' && (
              <ScrollView contentContainerStyle={{alignItems: 'center', width: '100%', paddingBottom: 60}} showsVerticalScrollIndicator={false}>
                  <View style={styles.headerBar}>
                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
                          <Image source={require('../../assets/images/cardia_heart.png')} style={styles.headerLogo} resizeMode="contain" />
                          <Text style={styles.brandTitle}>Cardia</Text>
                      </View>
                      
                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
                          <TouchableOpacity onPress={() => router.push('/calendar' as any)} style={{padding: 5, marginRight: 10}}>
                              <Ionicons name="calendar-outline" size={30} color="#8A6D72" />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => setShowProfileMenu(true)} style={styles.profileButton}>
                              <Ionicons name="person-circle" size={42} color="#D84361" />
                          </TouchableOpacity>
                      </View>
                  </View>
                  
                  <Text style={styles.tagline}>
                    {userName ? `${getGreeting()}, ${userName}.` : 'Vital Scanner & Health Assistant'}
                  </Text>
                  
                  <Animated.View style={{ transform: [{ scale: scaleAnim }], width: '100%', alignItems: 'center' }}>
                      <TouchableOpacity 
                          style={styles.hugeScanButton} 
                          onPress={() => setCurrentScreen('scanner')}
                          onPressIn={handlePressIn}
                          onPressOut={handlePressOut}
                          activeOpacity={0.9}
                      >
                          <View style={styles.scanButtonInner}>
                              <View style={styles.iconCircle}>
                                  <Ionicons name="finger-print-outline" size={45} color="#D84361" />
                              </View>
                              <Text style={styles.hugeScanText}>Take Daily Scan</Text>
                              <Text style={styles.scanSubText}>Analyze HRV & Stress</Text>
                          </View>
                      </TouchableOpacity>
                  </Animated.View>

                  <View style={styles.gridContainer}>
                      <TouchableOpacity style={[styles.gridCard, {backgroundColor: '#FDF4E3', borderColor: '#F2D399'}]} onPress={() => setCurrentScreen('food_scanner')}>
                          <Image source={require('../../assets/images/diet_icon.png')} style={styles.gridImgIcon} resizeMode="contain" />
                          <Text style={styles.gridTitle}>Dietary Scan</Text>
                          <Text style={styles.gridSubtitle}>Analyze Edibles</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.gridCard, {backgroundColor: '#E8F5E9', borderColor: '#A5D6A7'}]} onPress={() => setCurrentScreen('melio_chat')}>
                          <Image source={require('../../assets/images/brain_icon.png')} style={styles.gridImgIcon} resizeMode="contain" />
                          <Text style={styles.gridTitle}>Melio Chat</Text>
                          <Text style={styles.gridSubtitle}>Private & Offline</Text>
                      </TouchableOpacity>
                  </View>

                  <TouchableOpacity style={styles.anytimeChatButton} onPress={startAnytimeChat} activeOpacity={0.8}>
                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
                          <View style={styles.anytimeIconBg}>
                              <Ionicons name="chatbubbles-outline" size={24} color="#FFF" />
                          </View>
                          <View style={{marginLeft: 15}}>
                              <Text style={styles.anytimeTitle}>Chat with Cardia</Text>
                              <Text style={styles.anytimeSubtitle}>Ask about your health anytime</Text>
                          </View>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#D84361" />
                  </TouchableOpacity>

                  <View style={styles.graphContainer}>
                      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
                          
                          <TouchableOpacity activeOpacity={0.7} onPress={() => setShowMetricMenu(true)} style={{flexDirection: 'row', alignItems: 'center'}}>
                              <Text style={styles.graphTitle}>{selectedMetric}</Text>
                              <Ionicons name="chevron-down-circle" size={22} color="#D84361" style={{marginLeft: 6}} />
                          </TouchableOpacity>

                          <View style={styles.timeframeSelector}>
                              <TouchableOpacity onPress={() => setTimeframe('7_days')} style={[styles.timeframeBtn, timeframe === '7_days' && styles.timeframeBtnActive]}>
                                  <Text style={[styles.timeframeTxt, timeframe === '7_days' && styles.timeframeTxtActive]}>7D</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => setTimeframe('month')} style={[styles.timeframeBtn, timeframe === 'month' && styles.timeframeBtnActive]}>
                                  <Text style={[styles.timeframeTxt, timeframe === 'month' && styles.timeframeTxtActive]}>1M</Text>
                              </TouchableOpacity>
                          </View>
                      </View>
                      
                      {isLoadingTrends ? (
                          <ActivityIndicator size="large" color="#D84361" style={{ marginVertical: 40 }} />
                      ) : trendData.labels.length > 0 ? (
                          <LineChart
                            data={trendData}
                            width={screenWidth - 50}
                            height={220}
                            chartConfig={{
                              backgroundColor: '#FFFFFF',
                              backgroundGradientFrom: '#FFFFFF',
                              backgroundGradientTo: '#FFFFFF',
                              decimalPlaces: 0,
                              color: (opacity = 1) => `rgba(216, 67, 97, ${opacity})`, 
                              labelColor: (opacity = 1) => `rgba(92, 78, 80, ${opacity})`,
                              style: { borderRadius: 16 },
                              propsForDots: { r: "6", strokeWidth: "2", stroke: "#D84361", fill: "#FFF" }
                            }}
                            bezier={trendData.datasets[0].data.length > 1}
                            fromZero={true}
                            style={{ marginVertical: 8, borderRadius: 16 }}
                          />
                      ) : (
                          <View style={styles.emptyChartContainer}>
                              <Ionicons name="stats-chart-outline" size={45} color="#E0D4D6" />
                              <Text style={styles.emptyChartText}>Not enough data yet.</Text>
                          </View>
                      )}
                      
                      <Text style={styles.graphSubtitle}>{getGraphSubtitle()}</Text>
                  </View>
              </ScrollView>
          )}

          {currentScreen === 'scanner' && (
              <View style={{flex: 1, width: '100%', alignItems: 'center', backgroundColor: '#FFF5F5'}}>
                  <View style={styles.featureHeader}>
                      <TouchableOpacity onPress={handleBackToHome} style={styles.backButton}>
                          {!isRecording && <Ionicons name="arrow-back" size={28} color="#D84361" />}
                      </TouchableOpacity>
                      <Text style={styles.headerTitle}>Daily Vitals Scan</Text>
                      <View style={{width: 28}} />
                  </View>

                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                      <View style={styles.cameraWrapper}>
                          <Camera 
                              style={styles.camera} 
                              device={device} 
                              isActive={true} 
                              video={true} 
                              audio={false} 
                              torch={isCameraReady && (isCalibrating || isRecording) ? 'on' : 'off'} 
                              ref={cameraRef} 
                              onInitialized={() => setIsCameraReady(true)} 
                              resizeMode="cover" 
                          />
                          {isRecording && (
                              <View style={styles.recordingOverlay}>
                                  <View style={styles.recordingBadge}><View style={styles.redDot} /><Text style={styles.recordingText}>{timeLeft}s</Text></View>
                              </View>
                          )}
                      </View>

                      <View style={styles.controls}>
                        {!isCalibrating && !isRecording && (
                            <TouchableOpacity style={[styles.primaryButton, !isCameraReady && { backgroundColor: '#E0D4D6' }]} onPress={startCalibration} disabled={!isCameraReady}>
                                <Text style={styles.buttonText}>{isCameraReady ? "Prepare Finger Scan" : "Warming up lens..."}</Text>
                            </TouchableOpacity>
                        )}
                        {isCalibrating && !isRecording && (
                            <TouchableOpacity style={[styles.primaryButton, { backgroundColor: '#81C784' }]} onPress={startScan}>
                                <Text style={styles.buttonText}>Screen is Red - Start</Text>
                            </TouchableOpacity>
                        )}
                      </View>

                      {isRecording && (
                          <View style={styles.funFactContainer}>
                              <Text style={styles.funFactText}>{FUN_FACTS[funFactIndex]}</Text>
                          </View>
                      )}
                  </View>
              </View>
          )}

          {currentScreen === 'food_scanner' && (
              <FoodScanner 
                  onClose={() => setCurrentScreen('home')} 
                  onOpenChat={handleFoodChat} 
                  device={device} 
                  IP_ADDRESS={IP_ADDRESS} 
              />
          )}

          {currentScreen === 'melio_chat' && (
              <MelioChat onClose={() => setCurrentScreen('home')} />
          )}

          {currentScreen === 'cloud_chat' && (
              <KeyboardAvoidingView 
                  style={{flex: 1, width: '100%'}} 
                  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                  keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
              >
                  <View style={styles.featureHeader}>
                      <TouchableOpacity onPress={handleBackToHome} style={styles.backButton}>
                          <Ionicons name="arrow-back" size={28} color="#D84361" />
                      </TouchableOpacity>
                      <Text style={styles.headerTitle}>{isAnytimeMode ? "Cardia" : "Cardia Analysis"}</Text>
                      <View style={{width: 28}} />
                  </View>
                  
                  <ScrollView 
                      ref={chatScrollRef}
                      style={styles.chatArea} 
                      contentContainerStyle={{ flexGrow: 1, paddingBottom: 10 }}
                      keyboardShouldPersistTaps="handled"
                      onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
                  >
                      {chatHistory.map((msg) => (
                          <View key={msg.id} style={{marginBottom: 15}}>
                              
                              {msg.role === 'system' ? (
                                  <View style={styles.systemBubble}>
                                      <ActivityIndicator size="small" color="#A09395" style={{marginRight: 8}} />
                                      <Text style={styles.systemText}>{msg.text}</Text>
                                  </View>
                              ) : (
                                  <View>
                                      {msg.role === 'user' && msg.imageUri && (
                                          <Image source={{ uri: msg.imageUri }} style={styles.chatImageBubble} />
                                      )}
                                      <View style={msg.role === 'user' ? styles.userBubble : styles.agentBubble}>
                                          {msg.role === 'user' ? (
                                              <Text style={{color: '#FFF', fontFamily: 'Ubuntu_400Regular', fontSize: 16, lineHeight: 24}}>
                                                  {formatMessageText(msg.text || "Analyzed Image.")}
                                              </Text>
                                          ) : (
                                              <TypewriterText text={msg.text} isNew={msg.isNew} />
                                          )}
                                      </View>
                                      {msg.suggest_local && (
                                          <TouchableOpacity style={styles.handoffButton} onPress={() => setCurrentScreen('melio_chat')}>
                                              <Text style={{color: '#FFF', fontFamily: 'Ubuntu_500Medium'}}>🔒 Switch to Melio (Offline)</Text>
                                          </TouchableOpacity>
                                      )}
                                  </View>
                              )}
                          </View>
                      ))}
                  </ScrollView>

                  {selectedImage && (
                      <View style={styles.previewContainer}>
                          <Image source={{ uri: selectedImage.uri }} style={styles.previewImage} />
                          <TouchableOpacity style={styles.previewRemoveBtn} onPress={() => setSelectedImage(null)}>
                              <Ionicons name="close-circle" size={24} color="#D84361" />
                          </TouchableOpacity>
                      </View>
                  )}

                  <View style={styles.inputArea}>
                      <TouchableOpacity style={styles.attachButton} onPress={pickImage}>
                          <Ionicons name="add" size={28} color="#A09395" />
                      </TouchableOpacity>

                      <TextInput 
                          style={styles.input} 
                          value={inputText} 
                          onChangeText={setInputText} 
                          placeholder="Ask Cardia..." 
                          placeholderTextColor="#A09395" 
                          multiline={true} 
                          underlineColorAndroid="transparent"
                          onFocus={() => setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 300)}
                      />
                      
                      <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
                          <Ionicons name="arrow-up" size={22} color="#FFF" />
                      </TouchableOpacity>
                  </View>
              </KeyboardAvoidingView>
          )}
      </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF5F5', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight! + 10 : 40 },
  headerBar: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 25, marginTop: 15 },
  headerLogo: { width: 35, height: 35, marginRight: 10 },
  brandTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 38, color: '#D84361', letterSpacing: 0.5 },
  tagline: { fontFamily: 'Ubuntu_400Regular', color: '#8A6D72', marginBottom: 40, fontSize: 16, marginTop: 5 },
  profileButton: { padding: 5 },
  
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)' },
  dropdownMenu: { position: 'absolute', top: 90, right: 25, backgroundColor: '#FFF', borderRadius: 16, padding: 10, width: 170, shadowColor: '#D84361', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 15, elevation: 8 },
  
  modalOverlayCenter: { flex: 1, backgroundColor: 'rgba(92, 78, 80, 0.4)', justifyContent: 'center', alignItems: 'center' },
  metricModalCenter: { backgroundColor: '#FFF', borderRadius: 24, padding: 20, width: '75%', shadowColor: '#D84361', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 15, elevation: 8 },
  metricModalTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 20, color: '#D84361', textAlign: 'center', marginBottom: 15 },
  
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12 },
  menuText: { fontFamily: 'Ubuntu_500Medium', fontSize: 16, color: '#5C4E50', marginLeft: 12 },
  menuDivider: { height: 1, backgroundColor: '#FFE4E4', marginVertical: 5 },
  
  hugeScanButton: { width: '88%', backgroundColor: '#FFFFFF', borderRadius: 32, padding: 8, shadowColor: '#D84361', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 10, marginBottom: 30, borderWidth: 2, borderColor: '#FFE4E4' },
  scanButtonInner: { backgroundColor: '#FFF5F5', borderRadius: 26, paddingVertical: 35, paddingHorizontal: 30, alignItems: 'center', width: '100%' },
  iconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', marginBottom: 15, shadowColor: '#D84361', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  hugeScanText: { fontFamily: 'SourceSerifPro_700Bold', color: '#D84361', fontSize: 26, marginBottom: 5 },
  scanSubText: { fontFamily: 'Ubuntu_400Regular', color: '#8A6D72', fontSize: 15 },
  
  gridContainer: { flexDirection: 'row', justifyContent: 'space-between', width: '90%', paddingHorizontal: 5, alignSelf: 'center' },
  gridCard: { flex: 1, marginHorizontal: 8, paddingVertical: 25, paddingHorizontal: 15, borderRadius: 24, alignItems: 'center', borderWidth: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  gridImgIcon: { width: 45, height: 45, marginBottom: 12 },
  gridTitle: { fontFamily: 'Ubuntu_500Medium', fontSize: 17, color: '#5C4E50', textAlign: 'center' },
  gridSubtitle: { fontFamily: 'Ubuntu_400Regular', fontSize: 13, color: '#8A6D72', marginTop: 6, textAlign: 'center' },
  
  anytimeChatButton: { width: '85%', alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#D84361', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3, borderWidth: 1, borderColor: '#FFE4E4', marginTop: 25 },
  anytimeIconBg: { backgroundColor: '#D84361', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  anytimeTitle: { fontFamily: 'Ubuntu_500Medium', fontSize: 17, color: '#5C4E50' },
  anytimeSubtitle: { fontFamily: 'Ubuntu_400Regular', fontSize: 13, color: '#8A6D72', marginTop: 2 },

  featureHeader: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: '#FFE4E4', backgroundColor: '#FFFFFF' },
  backButton: { padding: 5 },
  headerTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 24, color: '#D84361' },
  
  cameraWrapper: { width: 280, height: 280, borderRadius: 140, overflow: 'hidden', backgroundColor: '#000', marginTop: 20, borderWidth: 8, borderColor: '#FFFFFF', shadowColor: '#D84361', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 15, position: 'relative', justifyContent: 'center', alignItems: 'center' },
  camera: { width: '105%', height: '105%', position: 'absolute', top: '-2.5%', left: '-2.5%' },
  recordingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(216, 67, 97, 0.1)', justifyContent: 'center', alignItems: 'center' },
  recordingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5 },
  redDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#D84361', marginRight: 8 },
  recordingText: { fontFamily: 'Ubuntu_500Medium', color: '#D84361', fontSize: 16 },
  
  funFactContainer: { marginTop: 40, paddingHorizontal: 40, alignItems: 'center' },
  funFactText: { fontFamily: 'Ubuntu_400Regular', fontSize: 16, color: '#8A6D72', textAlign: 'center', fontStyle: 'italic', lineHeight: 26 },
  controls: { marginTop: 40, width: '80%', alignItems: 'center' },
  primaryButton: { backgroundColor: '#D84361', paddingVertical: 18, borderRadius: 20, alignItems: 'center', width: '100%', shadowColor: '#D84361', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
  buttonText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', fontSize: 18 },
  
  chatArea: { flex: 1, width: '100%', padding: 15, backgroundColor: '#FAFAFA' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#D84361', padding: 16, borderRadius: 20, borderBottomRightRadius: 5, maxWidth: '80%', shadowColor: '#D84361', shadowOffset: {width:0, height:2}, shadowOpacity:0.15, shadowRadius:4 },
  agentBubble: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 20, borderBottomLeftRadius: 5, maxWidth: '80%', borderWidth: 1, borderColor: '#FFE4E4', shadowColor: '#000', shadowOffset: {width:0, height:2}, shadowOpacity:0.03, shadowRadius:4 },
  handoffButton: { alignSelf: 'flex-start', backgroundColor: '#5C4E50', padding: 12, borderRadius: 16, marginTop: 8, marginLeft: 5 },
  
  chatImageBubble: { width: 200, height: 200, borderRadius: 16, alignSelf: 'flex-end', marginBottom: 8 },
  previewContainer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 5, backgroundColor: '#FFFFFF', flexDirection: 'row' },
  previewImage: { width: 60, height: 60, borderRadius: 12, borderWidth: 1, borderColor: '#FFE4E4' },
  previewRemoveBtn: { position: 'absolute', top: 2, left: 65, backgroundColor: '#FFF', borderRadius: 12 },
  
  inputArea: { flexDirection: 'row', padding: 15, backgroundColor: '#FFFFFF', width: '100%', borderTopWidth: 1, borderColor: '#FFE4E4', paddingBottom: Platform.OS === 'ios' ? 30 : 15, alignItems: 'flex-end' },
  attachButton: { paddingRight: 10, paddingBottom: 10, justifyContent: 'center' },
  input: { flex: 1, fontFamily: 'Ubuntu_400Regular', backgroundColor: '#FFF5F5', color: '#5C4E50', borderRadius: 24, paddingHorizontal: 20, paddingTop: 15, paddingBottom: 15, marginRight: 12, minHeight: 50, maxHeight: 120, borderWidth: 1, borderColor: '#FFE4E4' },
  sendButton: { backgroundColor: '#D84361', justifyContent: 'center', alignItems: 'center', width: 50, height: 50, borderRadius: 25, shadowColor: '#D84361', shadowOffset: {width:0, height:3}, shadowOpacity:0.2, shadowRadius:5 },
  
  graphContainer: { width: '90%', marginTop: 25, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, shadowColor: '#D84361', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 15, elevation: 5, borderWidth: 1, borderColor: '#FFE4E4', zIndex: 10 },
  graphTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 20, color: '#5C4E50' },
  graphSubtitle: { fontFamily: 'Ubuntu_400Regular', fontSize: 13, color: '#8A6D72', textAlign: 'center', marginTop: 10 },
  timeframeSelector: { flexDirection: 'row', backgroundColor: '#FFF5F5', borderRadius: 20, padding: 4 },
  timeframeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  timeframeBtnActive: { backgroundColor: '#D84361' },
  timeframeTxt: { fontFamily: 'Ubuntu_500Medium', fontSize: 12, color: '#8A6D72' },
  timeframeTxtActive: { color: '#FFFFFF' },
  emptyChartContainer: { height: 220, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: 16, marginVertical: 8, borderWidth: 1, borderColor: '#FFE4E4', borderStyle: 'dashed' },
  emptyChartText: { fontFamily: 'Ubuntu_500Medium', color: '#8A6D72', marginTop: 15, fontSize: 16 },
  emptyChartSub: { fontFamily: 'Ubuntu_400Regular', color: '#A09395', fontSize: 13, marginTop: 5, textAlign: 'center', paddingHorizontal: 20 },
  
  systemBubble: { alignSelf: 'center', backgroundColor: '#F0EDED', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, marginVertical: 8, flexDirection: 'row', alignItems: 'center' },
  systemText: { color: '#8A6D72', fontFamily: 'Ubuntu_400Regular_Italic', fontSize: 13 }
});