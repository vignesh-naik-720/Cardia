import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, TouchableOpacity, Modal, Image, Platform } from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

type FoodResult = { id: string, name: string, verdict: 'safe' | 'warning' | 'unsafe', justification: string, box?: {x: number, y: number, w: number, h: number} };

interface FoodScannerProps {
    onClose: () => void;
    device: any;
    IP_ADDRESS: string;
}

export default function FoodScanner({ onClose, device, IP_ADDRESS }: FoodScannerProps) {
    const cameraRef = useRef<Camera>(null);
    const [isAnalyzingFood, setIsAnalyzingFood] = useState(false);
    const [isCameraInitialized, setIsCameraInitialized] = useState(false);
    
    const [foodResults, setFoodResults] = useState<FoodResult[]>([]);
    const [selectedFood, setSelectedFood] = useState<FoodResult | null>(null);
    const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);

    // 🚀 NEW: Consolidated pipeline for processing any image (Camera OR Gallery)
    const processImagePayload = async (uri: string) => {
        setCapturedImageUri(uri);
        setIsAnalyzingFood(true); 
        setFoodResults([]);
        
        try {
            let formData = new FormData();
            formData.append('image', { uri: uri, name: 'food.jpg', type: 'image/jpeg' } as any);
            
            const token = await AsyncStorage.getItem('userToken');
            const response = await fetch(`http://${IP_ADDRESS}:8000/api/analyze_food`, {
                method: 'POST', 
                body: formData, 
                headers: { 'Content-Type': 'multipart/form-data', 'Authorization': `Bearer ${token}` },
            });
            
            const data = await response.json();
            setFoodResults(data.results || []);
        } catch (error) { 
            console.error("Vision API Error:", error); 
            setCapturedImageUri(null); 
        } finally { 
            setIsAnalyzingFood(false); 
        }
    };

    // Handler 1: Live Camera Capture
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

    // Handler 2: Gallery Selection
    const pickFromGallery = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8, // Slight compression to keep latency low
                allowsEditing: false, 
            });

            if (!result.canceled && result.assets[0]) {
                const photoPath = result.assets[0].uri;
                // Ensure correct file path formatting for React Native
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
            <View style={[styles.featureHeader, {backgroundColor: '#000', borderBottomWidth: 0}]}>
                <TouchableOpacity onPress={onClose} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={28} color="#FFF" />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, {color: '#FFF'}]}>Dietary Vision</Text>
                <View style={{width: 28}} />
            </View>

            <View style={{flex: 1, position: 'relative'}}>
                {capturedImageUri ? (
                    <>
                        <Image source={{ uri: capturedImageUri }} style={{ flex: 1, width: '100%', height: '100%' }} resizeMode="cover" />
                        
                        {!isAnalyzingFood && foodResults.map((item, index) => {
                            const topVal = item.box ? (item.box.y + (item.box.h / 2)) * 100 : 50 + (index * 10);
                            const leftVal = item.box ? (item.box.x + (item.box.w / 2)) * 100 : 20;
                            
                            const top = `${topVal}%` as any;
                            const left = `${leftVal}%` as any;
                            
                            const isSafe = item.verdict === 'safe';
                            const isWarning = item.verdict === 'warning';
                            
                            return (
                                <TouchableOpacity 
                                    key={item.id || index.toString()} 
                                    style={[
                                        styles.arBlob, 
                                        { top, left },
                                        isSafe ? { backgroundColor: 'rgba(129, 199, 132, 0.85)' } : 
                                        isWarning ? { backgroundColor: 'rgba(255, 183, 77, 0.85)' } : 
                                        { backgroundColor: 'rgba(229, 115, 115, 0.85)' }
                                    ]}
                                    onPress={() => setSelectedFood(item)}
                                >
                                    <View style={styles.arBlobInner} />
                                </TouchableOpacity>
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

            <View style={styles.visionControls}>
                {!capturedImageUri ? (
                    <View style={styles.actionRow}>
                        {/* 🚀 NEW: Gallery Upload Button */}
                        <TouchableOpacity 
                            style={styles.sideButton} 
                            onPress={pickFromGallery}
                            disabled={isAnalyzingFood}
                        >
                            <Ionicons name="images" size={24} color="#FFF" />
                        </TouchableOpacity>

                        {/* Main Camera Capture Button */}
                        <TouchableOpacity 
                            style={[styles.captureButton, !isCameraInitialized && { opacity: 0.5 }]} 
                            onPress={captureFromCamera} 
                            disabled={isAnalyzingFood || !isCameraInitialized}
                        >
                            {isCameraInitialized ? (
                                <Ionicons name="scan-outline" size={34} color="#D84361" />
                            ) : (
                                <ActivityIndicator color="#D84361" />
                            )}
                        </TouchableOpacity>

                        {/* Invisible placeholder to keep the main button perfectly centered in the flex row */}
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

            <Modal visible={!!selectedFood} transparent animationType="slide">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{selectedFood?.name}</Text>
                        <View style={[styles.verdictBadge, selectedFood?.verdict === 'safe' ? {backgroundColor: '#81C784'} : selectedFood?.verdict === 'warning' ? {backgroundColor: '#FFB74D'} : {backgroundColor: '#E57373'}]}>
                            <Text style={styles.verdictText}>{selectedFood?.verdict?.toUpperCase()}</Text>
                        </View>
                        <Text style={styles.modalJustification}>{selectedFood?.justification}</Text>
                        
                        <TouchableOpacity style={[styles.modalCloseButton, {marginTop: 10, width: '100%', alignItems: 'center'}]} onPress={() => setSelectedFood(null)}>
                            <Text style={styles.buttonText}>Close</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    featureHeader: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15 },
    backButton: { padding: 5 },
    headerTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 24 },
    
    // Controls Container
    visionControls: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' },
    actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '65%' },
    
    // Buttons
    captureButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFF5F5', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#D84361', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5 },
    sideButton: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255, 255, 255, 0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.4)' },
    
    // AR Blobs
    arBlob: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 8, transform: [{ translateX: -22 }, { translateY: -22 }] },
    arBlobInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF', opacity: 0.85 },

    // Overlays & Modals
    scanningOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
    scanningText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', marginTop: 15, fontSize: 16 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { width: '85%', backgroundColor: '#FFF', borderRadius: 24, padding: 25, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 15 },
    modalTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 24, marginBottom: 15, color: '#5C4E50', textAlign: 'center' },
    verdictBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, marginBottom: 15 },
    verdictText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', fontSize: 13, letterSpacing: 0.5 },
    modalJustification: { fontFamily: 'Ubuntu_400Regular', fontSize: 16, color: '#8A6D72', textAlign: 'center', marginBottom: 25, lineHeight: 24 },
    modalCloseButton: { backgroundColor: '#D84361', paddingVertical: 14, paddingHorizontal: 35, borderRadius: 20 },
    buttonText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', fontSize: 18 },
});