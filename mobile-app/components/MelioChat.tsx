
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    StyleSheet, Text, View, ActivityIndicator, ScrollView,
    TouchableOpacity, TextInput, KeyboardAvoidingView, Platform,
    Linking, Modal, Animated
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { initLlama, LlamaContext } from 'llama.rn';
import { File, Paths } from 'expo-file-system'; 
import { useDownload, MODEL_FILENAME } from '../context/DownloadContext';

// Types & Interfaces
type MelioMessage = { role: 'user' | 'melio'; text: string };

interface MelioChatProps { 
    onClose: () => void;
    biometrics?: { metrics?: any, meta_scores?: any } | null;
}

interface MelioAlertButton {
    text: string;
    style?: 'default' | 'cancel' | 'destructive';
    onPress?: () => void;
}
interface MelioAlertConfig {
    title: string;
    body: string;
    buttons: MelioAlertButton[];
}

// Crisis Detection

const CRISIS_KEYWORDS = [
    'kill myself', 'end my life', 'want to die', 'suicide', 'suicidal',
    'not worth living', 'no reason to live', 'better off dead', 'end it all',
    'take my own life', "don't want to be here", 'disappear forever',
    'self harm', 'hurt myself', 'cutting myself', 'overdose',
];
const HELPLINE_MESSAGE =
    '\n\n💚 I want to make sure you have support right now. Please reach out:\n' +
    '• iCall (India): 9152987821\n' +
    '• Vandrevala Foundation: 1860-2662-345 (24/7, free)\n' +
    '• AASRA: 9820466627\n\n' +
    'You are not alone in this. Help is just a call away.';

const detectCrisis = (text: string) =>
    CRISIS_KEYWORDS.some(kw => text.toLowerCase().includes(kw));

// System Prompt — Conversational & Proactive CBT

const MELIO_SYSTEM_PROMPT = `You are Melio, a highly capable, offline mental wellness companion running directly on the user's device. 
Your goal is to be conversational, deeply empathetic, and highly practical. 

CORE RULES:
1. CONVERSATIONAL MEMORY: Pay close attention to the chat history. Remember the user's name, their past statements, and the flow of the conversation.
2. NATURAL RESPONSES: If the user is just chatting normally, doing math, or testing you, respond naturally to what they asked. Do NOT force mental health advice if they are just saying "hello" or asking a general question.
3. MENTAL HEALTH SUPPORT: If the user expresses stress, anxiety, or sadness, pivot to a supportive CBT (Cognitive Behavioral Therapy) style. Offer ONE practical grounding technique (like 4-7-8 breathing) or a gentle reframing question.
4. TONE: Speak warmly and concisely. Do not use generic filler like "I'm here for you."`;

//  NEW: Markdown Text Formatter

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

// Custom Alert Modal Component

function MelioAlertModal({ visible, config, onDismiss }: { visible: boolean; config: MelioAlertConfig | null; onDismiss: () => void; }) {
    const scaleAnim = useRef(new Animated.Value(0.85)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }),
                Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
            ]).start();
        } else {
            scaleAnim.setValue(0.85);
            opacityAnim.setValue(0);
        }
    }, [visible]);

    if (!config) return null;

    return (
        <Modal transparent visible={visible} animationType="none" onRequestClose={onDismiss}>
            <Animated.View style={[styles.modalOverlay, { opacity: opacityAnim }]}>
                <Animated.View style={[styles.modalCard, { transform: [{ scale: scaleAnim }] }]}>
                    <View style={styles.modalIconWrap}>
                        <Ionicons name="leaf" size={28} color="#2E7D32" />
                    </View>
                    <Text style={styles.modalTitle}>{config.title}</Text>
                    <Text style={styles.modalBody}>{config.body}</Text>
                    <View style={styles.modalDivider} />
                    <View style={styles.modalButtonRow}>
                        {config.buttons.map((btn, idx) => {
                            const isDestructive = btn.style === 'destructive';
                            const isCancel = btn.style === 'cancel';
                            return (
                                <React.Fragment key={idx}>
                                    {idx > 0 && <View style={styles.modalButtonSeparator} />}
                                    <TouchableOpacity
                                        style={[
                                            styles.modalButton,
                                            isDestructive && styles.modalButtonDestructive,
                                            isCancel && styles.modalButtonCancel,
                                        ]}
                                        onPress={() => { onDismiss(); btn.onPress?.(); }}
                                        activeOpacity={0.75}
                                    >
                                        <Text style={[
                                            styles.modalButtonText,
                                            isDestructive && styles.modalButtonTextDestructive,
                                            isCancel && styles.modalButtonTextCancel,
                                        ]}>
                                            {btn.text}
                                        </Text>
                                    </TouchableOpacity>
                                </React.Fragment>
                            );
                        })}
                    </View>
                </Animated.View>
            </Animated.View>
        </Modal>
    );
}

// Main Component

export default function MelioChat({ onClose, biometrics }: MelioChatProps) {
    const { isDownloading, isDownloaded, startDownload, cancelDownload, resetDownloadState } = useDownload();
    
    const [llama, setLlama] = useState<LlamaContext | null>(null);
    const llamaRef = useRef<LlamaContext | null>(null);

    const [melioHistory, setMelioHistory] = useState<MelioMessage[]>([]);
    const [streamingText, setStreamingText] = useState('');       
    const [isStreaming, setIsStreaming] = useState(false);        
    const [melioInput, setMelioInput] = useState('');
    const [isMelioThinking, setIsMelioThinking] = useState(false);

    const [alertVisible, setAlertVisible] = useState(false);
    const [alertConfig, setAlertConfig] = useState<MelioAlertConfig | null>(null);

    const melioScrollRef = useRef<ScrollView>(null);
    const isNearBottomRef = useRef(true);

    const showAlert = useCallback((config: MelioAlertConfig) => {
        setAlertConfig(config);
        setAlertVisible(true);
    }, []);

    const scrollToBottom = (animated = true) => {
        melioScrollRef.current?.scrollToEnd({ animated });
    };

    useEffect(() => {
        if (isDownloaded && !llamaRef.current) {
            bootEngine();
        }
        return () => { 
            if (llamaRef.current) {
                llamaRef.current.release(); 
                llamaRef.current = null;
            }
        };
    }, [isDownloaded]);

    useEffect(() => {
        if (isNearBottomRef.current) {
            setTimeout(() => scrollToBottom(), 80);
        }
    }, [melioHistory]);

    useEffect(() => {
        if (isStreaming) {
            setTimeout(() => scrollToBottom(), 50);
        }
    }, [streamingText]);

    const handleCloseChat = () => {
        if (melioHistory.length <= 1) { onClose(); return; }
        showAlert({
            title: 'End Session?',
            body: 'To protect your privacy, Melio never saves conversations. This session will be permanently cleared when you leave.',
            buttons: [
                { text: 'Stay', style: 'cancel' },
                {
                    text: 'Erase & Leave',
                    style: 'destructive',
                    onPress: () => { setMelioHistory([]); onClose(); }
                }
            ]
        });
    };

    const bootEngine = async () => {
        setIsMelioThinking(true);
        const modelFile = new File(Paths.document, MODEL_FILENAME);
        const rawPath = modelFile.uri.replace('file://', '');
        try {
            const ctx = await initLlama({ model: rawPath, use_mlock: false, n_ctx: 2048, n_gpu_layers: 1 });
            setLlama(ctx);
            llamaRef.current = ctx;

            let initialGreeting = "Hi, I'm Melio — a safe, private space just for you. Everything you share stays on this device, always.\n\nWhat's on your mind today?";
            
            if (biometrics?.meta_scores) {
                const stress = biometrics.meta_scores.stress_index;
                if (stress && stress > 70) {
                    initialGreeting = "Hi, I'm Melio — a safe, private space just for you.\n\nI noticed your physical stress levels are running a bit hot today. Is your mind racing right now, or is your body just exhausted?";
                } else if (stress && stress < 40) {
                    initialGreeting = "Hi, I'm Melio — a safe, private space just for you.\n\nYour vitals actually look incredibly calm and grounded today. How are you feeling mentally?";
                }
            }

            setMelioHistory([{ role: 'melio', text: initialGreeting }]);
        } catch (error) {
            console.error('Llama Init Error:', error);
            setMelioHistory([{ role: 'melio', text: 'The engine failed to start. Please tap the trash icon to delete and re-download.' }]);
        } finally {
            setIsMelioThinking(false);
        }
    };

    const deleteModelFile = () => {
        showAlert({
            title: 'Delete Offline Engine?',
            body: 'This will free up ~970 MB of storage. You will need to re-download it next time you open Melio.',
            buttons: [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        if (llama) { llama.release(); setLlama(null); llamaRef.current = null; }
                        try {
                            const modelFile = new File(Paths.document, MODEL_FILENAME);
                            if (modelFile.exists) await modelFile.delete();
                        } catch (_) {}
                        setMelioHistory([]);
                        resetDownloadState();
                    }
                }
            ]
        });
    };

    const sendMelioMessage = async () => {
        if (!melioInput.trim() || !llama || isMelioThinking || isStreaming) return;

        const userText = melioInput.trim();
        const isCrisis = detectCrisis(userText);

        const updatedHistory: MelioMessage[] = [...melioHistory, { role: 'user', text: userText }];
        setMelioHistory(updatedHistory);
        setMelioInput('');
        setIsMelioThinking(true);  
        isNearBottomRef.current = true;
        setTimeout(() => scrollToBottom(), 80);

        try {
        
            let finalPrompt = `<|im_start|>system\n${MELIO_SYSTEM_PROMPT}`;
           
            if (biometrics?.meta_scores?.stress_index && biometrics.meta_scores.stress_index > 70) {
                finalPrompt += `\n[LATENT DEVICE DATA: The user's biometric stress index is currently very high (${biometrics.meta_scores.stress_index}/100). Keep your tone extra calming.]`;
            }
            finalPrompt += `<|im_end|>\n`;
            
            const bootPhrases = ['Downloading', 'Download', 'failed', 'Starting', 'engine', "stays on this device"];
            
            const chatHistory = updatedHistory
                .filter(m => !bootPhrases.some(p => m.text.includes(p)))
                .slice(-20);

            for (const msg of chatHistory) {
                finalPrompt += msg.role === 'user'
                    ? `<|im_start|>user\n${msg.text}<|im_end|>\n`
                    : `<|im_start|>assistant\n${msg.text}<|im_end|>\n`;
            }
            finalPrompt += `<|im_start|>assistant\n`;

            let accumulated = '';
            setStreamingText('');
            setIsStreaming(true);
            setIsMelioThinking(false);

            await llama.completion(
                {
                    prompt: finalPrompt,
                    n_predict: 300,
                    temperature: 0.7, 
                    top_p: 0.9,
                    top_k: 40,
                    penalty_repeat: 1.1, 
                    stop: ['<|im_end|>', '<|im_start|>'],
                },
                (data: { token: string }) => {
                    accumulated += data.token;
                    setStreamingText(accumulated);
                }
            );

            let finalText = accumulated.trim();
            if (isCrisis && !finalText.includes('9152987821')) finalText += HELPLINE_MESSAGE;

            setIsStreaming(false);
            setStreamingText('');
            setMelioHistory(prev => [...prev, { role: 'melio', text: finalText }]);

        } catch (error) {
            console.error('Completion error:', error);
            setIsStreaming(false);
            setStreamingText('');
            setIsMelioThinking(false);
            setMelioHistory(prev => [...prev, { role: 'melio', text: "I had a small hiccup — please try again." }]);
        }
    };

    const handleHelplinePress = (text: string) => {
        const match = text.match(/\b(9152987821|18602662345|9820466627)\b/);
        if (match) Linking.openURL(`tel:${match[0]}`);
    };

    const renderMessageText = (msg: MelioMessage) => {
        const hasHelpline = msg.text.includes('9152987821');
        if (hasHelpline) return (
            <TouchableOpacity activeOpacity={0.8} onPress={() => handleHelplinePress(msg.text)}>
                {/* 🚀 Render with the bold formatter */}
                <Text style={styles.bubbleText}>{formatMessageText(msg.text)}</Text>
                <Text style={styles.tapToCallHint}>Tap to call a helpline</Text>
            </TouchableOpacity>
        );
      
        return <Text style={styles.bubbleText}>{formatMessageText(msg.text)}</Text>;
    };

    return (
        <KeyboardAvoidingView
            style={{ flex: 1, width: '100%' }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
            <MelioAlertModal visible={alertVisible} config={alertConfig} onDismiss={() => setAlertVisible(false)} />

            <View style={styles.featureHeader}>
                <TouchableOpacity onPress={handleCloseChat} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={28} color="#FFF" />
                </TouchableOpacity>
                <View style={{ alignItems: 'center' }}>
                    <Text style={styles.headerTitle}>Melio</Text>
                    <Text style={styles.headerSubtitle}>Private · On-Device · Secure</Text>
                </View>
                <TouchableOpacity
                    onPress={deleteModelFile}
                    style={styles.backButton}
                    disabled={isDownloading || !isDownloaded}
                >
                    <Ionicons name="trash-outline" size={24} color={isDownloading || !isDownloaded ? 'transparent' : '#C8E6C9'} />
                </TouchableOpacity>
            </View>

            {}
            {!isDownloaded && !isDownloading ? (
                <View style={styles.consentContainer}>
                    <View style={styles.consentCard}>
                        <View style={styles.shieldIconWrap}>
                            <Ionicons name="shield-checkmark" size={46} color="#2E7D32" />
                        </View>
                        <Text style={styles.consentTitle}>Your Privacy.{'\n'}Always.</Text>
                        <Text style={styles.consentBody}>
                            Melio runs entirely on your device. Your thoughts and feelings are{' '}
                            <Text style={styles.consentEmphasis}>never sent to any server</Text>
                            {' '}— not now, not ever.
                        </Text>
                        <Text style={styles.consentBody}>
                            This requires a one-time download of{' '}
                            <Text style={styles.consentEmphasisDark}>~970 MB</Text>.
                            {' '}Wi-Fi recommended.
                        </Text>

                        <View style={styles.badgeRow}>
                            {[
                                { icon: 'person-remove-outline', label: 'No Account' },
                                { icon: 'cloud-offline-outline', label: 'No Cloud' },
                                { icon: 'eye-off-outline', label: 'No Tracking' },
                            ].map(({ icon, label }) => (
                                <View key={label} style={styles.badge}>
                                    <Ionicons name={icon as any} size={15} color="#2E7D32" />
                                    <Text style={styles.badgeText}>{label}</Text>
                                </View>
                            ))}
                        </View>

                        <TouchableOpacity style={styles.downloadButton} onPress={startDownload} activeOpacity={0.85}>
                            <Ionicons name="cloud-download-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                            <Text style={styles.downloadButtonText}>Download & Enable Melio</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.cancelButtonTextWrap} onPress={onClose}>
                            <Text style={styles.cancelButtonText}>Not Right Now</Text>
                        </TouchableOpacity>
                    </View>
                </View>

      
            ) : isDownloading ? (
                <View style={styles.consentContainer}>
                    <View style={styles.consentCard}>
                        <Text style={styles.consentTitle}>Downloading Melio</Text>
                        
                        {/* The Loader & Cancel Button Layout */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 25, backgroundColor: '#E8F5E9', padding: 15, borderRadius: 16, width: '100%', justifyContent: 'space-between' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <ActivityIndicator size="large" color="#2E7D32" style={{ marginRight: 15 }} />
                                <Text style={{ fontFamily: 'Ubuntu_500Medium', color: '#2E7D32', fontSize: 16 }}>Downloading Engine...</Text>
                            </View>
                            <TouchableOpacity onPress={cancelDownload} style={{ padding: 5 }}>
                                <Ionicons name="close-circle" size={28} color="#D84361" />
                            </TouchableOpacity>
                        </View>
                        
                        <Text style={styles.consentBody}>
                            You can leave this screen, it will silently continue in the background!
                        </Text>
                    </View>
                </View>

         
            ) : (
                <>
                    <ScrollView
                        ref={melioScrollRef}
                        style={styles.chatArea}
                        contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }}
                        keyboardShouldPersistTaps="handled"
                        onScroll={(e) => {
                            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
                            isNearBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
                        }}
                        scrollEventThrottle={100}
                    >
                        {melioHistory.map((msg, i) => (
                            <View key={i} style={styles.messageRow}>
                                {msg.role === 'melio' && <Text style={styles.senderLabel}>Melio</Text>}
                                <View style={msg.role === 'user' ? styles.userBubble : styles.melioBubble}>
                                    {renderMessageText(msg)}
                                </View>
                            </View>
                        ))}

                        {isMelioThinking && (
                            <View style={styles.messageRow}>
                                <Text style={styles.senderLabel}>Melio</Text>
                                <View style={styles.melioBubble}>
                                    <View style={styles.thinkingDots}>
                                        {[0, 1, 2].map(i => (
                                            <View key={i} style={[styles.dot, { opacity: 0.4 + i * 0.2 }]} />
                                        ))}
                                    </View>
                                </View>
                            </View>
                        )}

                        {isStreaming && streamingText.length > 0 && (
                            <View style={styles.messageRow}>
                                <Text style={styles.senderLabel}>Melio</Text>
                                <View style={styles.melioBubble}>
                                    {/* 🚀 Render streaming text with the bold formatter */}
                                    <Text style={styles.bubbleText}>{formatMessageText(streamingText)}</Text>
                                    <Text style={styles.cursor}>▋</Text>
                                </View>
                            </View>
                        )}
                    </ScrollView>

                    <View style={styles.inputArea}>
                        <TextInput
                            style={styles.input}
                            value={melioInput}
                            onChangeText={setMelioInput}
                            placeholder="Share what's on your mind..."
                            placeholderTextColor="#A09395"
                            editable={!isMelioThinking && !isStreaming && !!llama}
                            multiline
                            underlineColorAndroid="transparent"
                            onFocus={() => setTimeout(() => scrollToBottom(), 300)}
                            onSubmitEditing={sendMelioMessage}
                        />
                        <TouchableOpacity
                            style={[
                                styles.sendButton,
                                { backgroundColor: melioInput.trim() && llama && !isStreaming ? '#2E7D32' : '#A5C8A7' }
                            ]}
                            onPress={sendMelioMessage}
                            disabled={isMelioThinking || isStreaming || !llama || !melioInput.trim()}
                        >
                            <Ionicons name="send" size={18} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                </>
            )}
        </KeyboardAvoidingView>
    );
}


const styles = StyleSheet.create({
    featureHeader: {
        width: '100%', flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15,
        backgroundColor: '#2E7D32',
    },
    backButton: { padding: 5 },
    headerTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 24, color: '#FFF' },
    headerSubtitle: { color: '#C8E6C9', fontSize: 12, fontFamily: 'Ubuntu_400Regular' },

    modalOverlay: {
        flex: 1, backgroundColor: 'rgba(10,30,10,0.55)',
        justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28,
    },
    modalCard: {
        backgroundColor: '#FFFFFF', borderRadius: 28, paddingTop: 28,
        paddingHorizontal: 24, paddingBottom: 0, width: '100%',
        shadowColor: '#1B5E20', shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.18, shadowRadius: 32, elevation: 20,
        alignItems: 'center',
    },
    modalIconWrap: {
        width: 60, height: 60, borderRadius: 30,
        backgroundColor: '#E8F5E9', justifyContent: 'center',
        alignItems: 'center', marginBottom: 16,
    },
    modalTitle: {
        fontFamily: 'SourceSerifPro_700Bold', fontSize: 20,
        color: '#1B5E20', textAlign: 'center', marginBottom: 10,
    },
    modalBody: {
        fontFamily: 'Ubuntu_400Regular', fontSize: 14, color: '#6D5B5F',
        textAlign: 'center', lineHeight: 21, marginBottom: 20,
    },
    modalDivider: { width: '100%', height: 1, backgroundColor: '#F0F4F0', marginBottom: 4 },
    modalButtonRow: { flexDirection: 'row', width: '100%' },
    modalButtonSeparator: { width: 1, backgroundColor: '#F0F4F0' },
    modalButton: {
        flex: 1, paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    },
    modalButtonCancel: {},
    modalButtonDestructive: {},
    modalButtonText: {
        fontFamily: 'Ubuntu_500Medium', fontSize: 15, color: '#2E7D32',
    },
    modalButtonTextCancel: { color: '#A09395' },
    modalButtonTextDestructive: { color: '#D84361' },

    consentContainer: {
        flex: 1, backgroundColor: '#F5F9F5', justifyContent: 'center', alignItems: 'center', padding: 22,
    },
    consentCard: {
        backgroundColor: '#FFFFFF', width: '100%', borderRadius: 28, padding: 28,
        alignItems: 'center', shadowColor: '#1B5E20', shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.1, shadowRadius: 24, elevation: 8,
    },
    shieldIconWrap: {
        width: 84, height: 84, borderRadius: 42, backgroundColor: '#E8F5E9',
        justifyContent: 'center', alignItems: 'center', marginBottom: 22,
    },
    consentTitle: {
        fontFamily: 'SourceSerifPro_700Bold', fontSize: 28, color: '#1B5E20',
        marginBottom: 14, textAlign: 'center', lineHeight: 36,
    },
    consentBody: {
        fontFamily: 'Ubuntu_400Regular', fontSize: 15, color: '#7A6670',
        textAlign: 'center', marginBottom: 14, lineHeight: 23,
    },
    consentEmphasis: { fontFamily: 'Ubuntu_500Medium', color: '#2E7D32' },
    consentEmphasisDark: { fontFamily: 'Ubuntu_500Medium', color: '#5C4E50' },
    badgeRow: {
        flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 26,
        flexWrap: 'wrap', justifyContent: 'center',
    },
    badge: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: '#E8F5E9', paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 20,
    },
    badgeText: { fontFamily: 'Ubuntu_500Medium', fontSize: 12, color: '#2E7D32' },
    downloadButton: {
        flexDirection: 'row', backgroundColor: '#2E7D32', width: '100%',
        paddingVertical: 17, borderRadius: 22, justifyContent: 'center', alignItems: 'center',
        shadowColor: '#1B5E20', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 12,
    },
    downloadButtonText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', fontSize: 16 },
    cancelButtonTextWrap: { marginTop: 18, paddingVertical: 8, width: '100%', alignItems: 'center' },
    cancelButtonText: { fontFamily: 'Ubuntu_500Medium', color: '#A09395', fontSize: 15 },

    chatArea: { flex: 1, width: '100%', paddingHorizontal: 15, paddingTop: 12, backgroundColor: '#F5F9F5' },
    messageRow: { marginBottom: 14 },
    senderLabel: {
        fontFamily: 'Ubuntu_500Medium', fontSize: 11, color: '#A09395',
        marginBottom: 4, marginLeft: 4,
    },
    
    userBubble: {
        alignSelf: 'flex-end', backgroundColor: '#FFE4E4', padding: 15,
        borderRadius: 20, borderBottomRightRadius: 4, maxWidth: '80%',
        shadowColor: '#D84361', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 6,
    },
    
    melioBubble: {
        alignSelf: 'flex-start', backgroundColor: '#E8F5E9', padding: 15,
        borderRadius: 20, borderBottomLeftRadius: 4, maxWidth: '84%',
        shadowColor: '#2E7D32', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 6,
    },
    
    bubbleText: { color: '#5C4E50', fontFamily: 'Ubuntu_400Regular', fontSize: 15.5, lineHeight: 23 },
    
    tapToCallHint: {
        color: '#2E7D32', fontFamily: 'Ubuntu_500Medium', fontSize: 12,
        marginTop: 8, textDecorationLine: 'underline',
    },
    
    thinkingDots: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2E7D32' },
    cursor: { color: '#2E7D32', fontSize: 14, marginTop: 2 },
    
    inputArea: {
        flexDirection: 'row', padding: 14, backgroundColor: '#FFFFFF', width: '100%',
        borderTopWidth: 1, borderColor: '#E8F5E9',
        paddingBottom: Platform.OS === 'ios' ? 28 : 14, alignItems: 'flex-end',
    },
    input: {
        flex: 1, fontFamily: 'Ubuntu_400Regular', backgroundColor: '#F5F9F5', color: '#5C4E50',
        borderRadius: 24, paddingHorizontal: 18, paddingTop: 13, paddingBottom: 13,
        marginRight: 10, minHeight: 48, maxHeight: 120, borderWidth: 1, borderColor: '#D8EDD8',
        fontSize: 15,
    },
    sendButton: {
        justifyContent: 'center', alignItems: 'center',
        width: 48, height: 48, borderRadius: 24,
    },
});
