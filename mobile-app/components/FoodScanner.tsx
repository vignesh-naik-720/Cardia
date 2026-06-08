import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, TouchableOpacity, Modal, Image, Platform, ScrollView, Animated, Easing } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

export type FoodResult = { 
    id: string; 
    name: string; 
    verdict: 'safe' | 'warning' | 'unsafe'; 
    detailed_guideline: string;
    macro_1_name: string;
    macro_1_amount: string;
    macro_2_name: string;
    macro_2_amount: string;
    box?: {x: number, y: number, w: number, h: number};
};

interface FoodScannerProps {
    onClose: () => void;
    onOpenChat: (foodItem: FoodResult) => void; 
    device: any;
    IP_ADDRESS: string;
}

const ConcentricRing = ({ color, delay }: { color: string, delay: number }) => {
    const animationValue = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const timeout = setTimeout(() => {
            Animated.loop(
                Animated.timing(animationValue, {
                    toValue: 1,
                    duration: 2500, 
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                })
            ).start();
        }, delay);

        return () => clearTimeout(timeout);
    }, [delay]);

    const scale = animationValue.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 2.5], 
    });

    const opacity = animationValue.interpolate({
        inputRange: [0, 0.1, 1],
        outputRange: [0, 1, 0], 
    });

    return (
        <Animated.View
            style={[
                styles.concentricRing,
                { borderColor: color },
                { transform: [{ scale }], opacity },
            ]}
        />
    );
};

export default function FoodScanner({ onClose, onOpenChat, device, IP_ADDRESS }: FoodScannerProps) {
    const cameraRef = useRef<Camera>(null);
    const [isAnalyzingFood, setIsAnalyzingFood] = useState(false);
    const [isCameraInitialized, setIsCameraInitialized] = useState(false);
    
    const [foodResults, setFoodResults] = useState<FoodResult[]>([]);
    const [selectedFood, setSelectedFood] = useState<FoodResult | null>(null);
    const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);

    const processImagePayload = async (uri: string) => {
        setCapturedImageUri(uri);
        setIsAnalyzingFood(true); 
        setFoodResults([]);
        
        try {
            let formData = new FormData();
            formData.append('image', { uri: uri, name: 'food.jpg', type: 'image/jpeg' } as any);
            
            const token = await AsyncStorage.getItem('userToken');
            const response = await fetch(`${IP_ADDRESS}/api/analyze_food`, {
                method: 'POST', 
                body: formData, 
                headers: { 'Content-Type': 'multipart/form-data', 'Authorization': `Bearer ${token}` },
            });
            
            const data = await response.json();
            setFoodResults(data.results || []);
        } catch (error) { 
            console.error("Vision API Error:", error); 
        } finally { 
            setIsAnalyzingFood(false); 
        }
    };

    const captureFromCamera = async () => {
        if (!cameraRef.current || !isCameraInitialized) return;
        try {
            const photo = await cameraRef.current.takePhoto({ flash: 'off' });
            const uri = Platform.OS === 'android' && !photo.path.startsWith('file://') ? `file://${photo.path}` : photo.path;
            await processImagePayload(uri);
        } catch (error) {
            console.error("Camera Error:", error);
        }
    };

    const pickFromGallery = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8, 
                allowsEditing: false, 
            });

            if (!result.canceled && result.assets[0]) {
                const photoPath = result.assets[0].uri;
                const uri = Platform.OS === 'android' && !photoPath.startsWith('file://') && !photoPath.startsWith('content://') 
                    ? `file://${photoPath}` 
                    : photoPath;
                
                await processImagePayload(uri);
            }
        } catch (error) {
            console.error("Gallery Error:", error);
        }
    };

    return (
        <View style={{flex: 1, width: '100%', backgroundColor: '#000'}}>
            
            {/* 1. MAIN CAMERA VIEW */}
            <View style={{flex: 1, position: 'relative'}}>
                {capturedImageUri ? (
                    <>
                        <Image source={{ uri: capturedImageUri }} style={{ flex: 1, width: '100%', height: '100%' }} resizeMode="cover" />
                        
                        {!isAnalyzingFood && foodResults.map((item, index) => {
                            const topVal = item.box ? (item.box.y + (item.box.h / 2)) * 100 : 50 + (index * 10);
                            const leftVal = item.box ? (item.box.x + (item.box.w / 2)) * 100 : 20;
                            
                            const top = `${topVal}%` as any;
                            const left = `${leftVal}%` as any;

                            const getVerdictColor = (verdict: string, opacity: number = 0.85) => {
                                if (verdict === 'safe') return `rgba(129, 199, 132, ${opacity})`;
                                if (verdict === 'warning') return `rgba(255, 183, 77, ${opacity})`;
                                return `rgba(229, 115, 115, ${opacity})`;
                            };
                            
                            const verdictColor = getVerdictColor(item.verdict);
                            const verdictBorderColor = getVerdictColor(item.verdict, 1.0); 

                            return (
                                <View key={item.id || index.toString()} style={[styles.arAnchorPoint, { top, left }]} pointerEvents="box-none">
                                    <View style={styles.ringContainer} pointerEvents="none">
                                        <ConcentricRing color={verdictBorderColor} delay={0} />
                                        <ConcentricRing color={verdictBorderColor} delay={800} />
                                        <ConcentricRing color={verdictBorderColor} delay={1600} />
                                    </View>

                                    <TouchableOpacity 
                                        style={styles.touchablePin}
                                        onPress={() => setSelectedFood(item)}
                                        activeOpacity={0.8}
                                    >
                                        <View style={[styles.arBlobMainCircle, { backgroundColor: verdictColor }]}>
                                            <View style={styles.arBlobInner} />
                                        </View>
                                        <View style={[styles.arPointerTriangle, { borderTopColor: verdictColor }]} />
                                    </TouchableOpacity>
                                </View>
                            );
                        })}
                    </>
                ) : (
                    device && (
                        <Camera 
                            style={{flex: 1}} 
                            device={device} 
                            isActive={true} 
                            photo={true} 
                            ref={cameraRef} 
                            onInitialized={() => setIsCameraInitialized(true)}
                        />
                    )
                )}

                {isAnalyzingFood && (
                    <View style={styles.scanningOverlay}>
                        <ActivityIndicator size="large" color="#D84361" />
                        <Text style={styles.scanningText}>Analyzing Nutrition...</Text>
                    </View>
                )}
            </View>

            {/* 2. VISION CONTROLS */}
            <View style={styles.visionControls}>
                {!capturedImageUri ? (
                    <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.sideButton} onPress={pickFromGallery} disabled={isAnalyzingFood}>
                            <Ionicons name="images" size={24} color="#FFF" />
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.captureButton, !isCameraInitialized && { opacity: 0.5 }]} onPress={captureFromCamera} disabled={isAnalyzingFood || !isCameraInitialized}>
                            {isCameraInitialized ? <Ionicons name="scan-outline" size={34} color="#D84361" /> : <ActivityIndicator color="#D84361" />}
                        </TouchableOpacity>

                        <View style={{ width: 54 }} />
                    </View>
                ) : (
                    <TouchableOpacity style={[styles.captureButton, { backgroundColor: '#FFF', width: 60, height: 60, borderRadius: 30, borderWidth: 2 }]} onPress={() => { 
                        setCapturedImageUri(null); 
                        setFoodResults([]); 
                        setSelectedFood(null); 
                        setIsCameraInitialized(false);
                    }}>
                        <Ionicons name="refresh-outline" size={28} color="#5C4E50" />
                    </TouchableOpacity>
                )}
            </View>

            {/* 3. FLOATING HEADER (Moved to bottom of JSX so it paints OVER the camera on Android) */}
            <View style={[styles.featureHeader, {backgroundColor: 'rgba(0,0,0,0.5)', borderBottomWidth: 0}]}>
                <TouchableOpacity onPress={onClose} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={28} color="#FFF" />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, {color: '#FFF'}]}>Dietary Vision</Text>
                <View style={{width: 28}} />
            </View>

            {/* 4. DETAILS MODAL */}
            <Modal visible={!!selectedFood} transparent animationType="slide">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{selectedFood?.name}</Text>
                        <View style={[styles.verdictBadge, selectedFood?.verdict === 'safe' ? {backgroundColor: '#81C784'} : selectedFood?.verdict === 'warning' ? {backgroundColor: '#FFB74D'} : {backgroundColor: '#E57373'}]}>
                            <Text style={styles.verdictText}>{selectedFood?.verdict?.toUpperCase()}</Text>
                        </View>
                        
                        <View style={styles.macroGrid}>
                            <View style={styles.macroCard}>
                                <Text style={styles.macroValue}>{selectedFood?.macro_1_amount}</Text>
                                <Text style={styles.macroName}>{selectedFood?.macro_1_name}</Text>
                            </View>
                            <View style={styles.macroCard}>
                                <Text style={styles.macroValue}>{selectedFood?.macro_2_amount}</Text>
                                <Text style={styles.macroName}>{selectedFood?.macro_2_name}</Text>
                            </View>
                        </View>

                        <ScrollView style={{maxHeight: 120, width: '100%', marginBottom: 20}} showsVerticalScrollIndicator={false}>
                            <Text style={styles.modalJustification}>{selectedFood?.detailed_guideline}</Text>
                        </ScrollView>
                        
                        <View style={styles.actionButtonRow}>
                            <TouchableOpacity style={styles.chatHandoffButton} onPress={() => {
                                if (selectedFood) onOpenChat(selectedFood);
                                setSelectedFood(null);
                            }}>
                                <Ionicons name="chatbubbles" size={20} color="#FFF" style={{marginRight: 8}} />
                                <Text style={styles.buttonText}>Ask Cardia</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setSelectedFood(null)}>
                                <Text style={styles.buttonTextDark}>Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const BLOB_DIAMETER = 44;
const TRIANGLE_HEIGHT = 14;
const TOTAL_ANCHOR_OFFSET_Y = BLOB_DIAMETER + TRIANGLE_HEIGHT; 
const TOTAL_ANCHOR_OFFSET_X = BLOB_DIAMETER / 2; 

const styles = StyleSheet.create({
   
    featureHeader: { 
        position: 'absolute', 
        top: 0, 
        left: 0, 
        right: 0, 
        zIndex: 999, 
        elevation: 10,
        width: '100%', 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        paddingHorizontal: 20, 
        paddingVertical: 15,
        paddingTop: Platform.OS === 'ios' ? 50 : 30, 
    },
    backButton: { padding: 5 },
    headerTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 24 },
    
    visionControls: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center', zIndex: 100, elevation: 5 },
    actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '65%' },
    
    captureButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFF5F5', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#D84361', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5 },
    sideButton: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255, 255, 255, 0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.4)' },
    
    arAnchorPoint: { position: 'absolute', width: 0, height: 0, zIndex: 10 },
    ringContainer: { position: 'absolute', top: -(TRIANGLE_HEIGHT + BLOB_DIAMETER), left: -TOTAL_ANCHOR_OFFSET_X, width: BLOB_DIAMETER, height: BLOB_DIAMETER, justifyContent: 'center', alignItems: 'center' },
    concentricRing: { position: 'absolute', width: BLOB_DIAMETER, height: BLOB_DIAMETER, borderRadius: BLOB_DIAMETER / 2, borderWidth: 2, backgroundColor: 'transparent' },
    touchablePin: { position: 'absolute', width: BLOB_DIAMETER, height: TOTAL_ANCHOR_OFFSET_Y, alignItems: 'center', left: -TOTAL_ANCHOR_OFFSET_X, top: -TOTAL_ANCHOR_OFFSET_Y },
    
    arBlobMainCircle: { width: BLOB_DIAMETER, height: BLOB_DIAMETER, borderRadius: BLOB_DIAMETER / 2, borderWidth: 3, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 8 },
    arBlobInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', opacity: 0.85 },
    arPointerTriangle: { width: 0, height: 0, backgroundColor: 'transparent', borderStyle: 'solid', borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: TRIANGLE_HEIGHT, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -3, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4 },

    scanningOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
    scanningText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', marginTop: 15, fontSize: 16 },
    
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { width: '88%', backgroundColor: '#FFF', borderRadius: 24, padding: 25, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 15 },
    modalTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 24, marginBottom: 12, color: '#5C4E50', textAlign: 'center' },
    verdictBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, marginBottom: 20 },
    verdictText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', fontSize: 13, letterSpacing: 0.5 },
    
    macroGrid: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 20 },
    macroCard: { flex: 1, backgroundColor: '#FFF5F5', borderRadius: 16, paddingVertical: 12, marginHorizontal: 5, alignItems: 'center', borderWidth: 1, borderColor: '#FFE4E4' },
    macroValue: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 18, color: '#D84361', marginBottom: 2 },
    macroName: { fontFamily: 'Ubuntu_500Medium', fontSize: 12, color: '#8A6D72' },
    
    modalJustification: { fontFamily: 'Ubuntu_400Regular', fontSize: 15, color: '#5C4E50', textAlign: 'center', lineHeight: 24 },
    
    actionButtonRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 5 },
    chatHandoffButton: { flex: 1, backgroundColor: '#D84361', flexDirection: 'row', paddingVertical: 14, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    modalCloseButton: { backgroundColor: '#F0EDED', paddingVertical: 14, paddingHorizontal: 25, borderRadius: 20, justifyContent: 'center' },
    buttonText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', fontSize: 16 },
    buttonTextDark: { fontFamily: 'Ubuntu_500Medium', color: '#8A6D72', fontSize: 16 },
});
