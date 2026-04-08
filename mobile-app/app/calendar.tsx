import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, SafeAreaView, TouchableOpacity, ScrollView, Animated, Platform, StatusBar, ActivityIndicator } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, Ubuntu_400Regular, Ubuntu_500Medium } from '@expo-google-fonts/ubuntu';
import { SourceSerifPro_700Bold } from '@expo-google-fonts/source-serif-pro';
import AsyncStorage from '@react-native-async-storage/async-storage';

const IP_ADDRESS = "10.179.25.130"

export default function CalendarScreen() {
  const router = useRouter();
  const [fontsLoaded] = useFonts({
    Ubuntu_400Regular,
    Ubuntu_500Medium,
    SourceSerifPro_700Bold,
  });

  const [markedDates, setMarkedDates] = useState<any>({});
  const [selectedDateData, setSelectedDateData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCalendarData = async () => {
      try {
        const token = await AsyncStorage.getItem('userToken');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`http://${IP_ADDRESS}:8000/api/calendar`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await response.json();
        const scannedDates = data.scanned_dates || [];
        
        const marks: any = {};
        const today = new Date();
        
        for (let i = 30; i >= 0; i--) {
          const d = new Date();
          d.setDate(today.getDate() - i);
          const dateStr = d.toISOString().split('T')[0];
          
          if (scannedDates.includes(dateStr)) {
            marks[dateStr] = { customStyles: { container: { backgroundColor: '#E8F5E9', width: 38, height: 38, borderRadius: 19 }, text: { color: '#2E7D32', fontFamily: 'Ubuntu_500Medium' } } };
          } else {
            marks[dateStr] = { customStyles: { container: { backgroundColor: '#FDF4E3', width: 38, height: 38, borderRadius: 19 }, text: { color: '#B78A35', fontFamily: 'Ubuntu_500Medium' } } };
          }
        }
        setMarkedDates(marks);
      } catch (e) {
        const marks: any = {};
        const today = new Date();
        for (let i = 30; i >= 0; i--) {
          const d = new Date();
          d.setDate(today.getDate() - i);
          marks[d.toISOString().split('T')[0]] = { customStyles: { container: { backgroundColor: '#FDF4E3', width: 38, height: 38, borderRadius: 19 }, text: { color: '#B78A35', fontFamily: 'Ubuntu_500Medium' } } };
        }
        setMarkedDates(marks);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCalendarData();
  }, []);

  const fetchDateContext = async (dateString: string) => {
    setSelectedDateData(null); 
    try {
      const token = await AsyncStorage.getItem('userToken');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`http://${IP_ADDRESS}:8000/api/scan/${dateString}`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      const data = await response.json();
      
      if (data.status === 'no_data') {
          setSelectedDateData({ empty: true, date: dateString });
      } else {
          setSelectedDateData({
              empty: false,
              date: dateString,
              heuristics: data.heuristics
          });
      }
    } catch (e) {
      setSelectedDateData({ empty: true, date: dateString });
    }
  };

  if (!fontsLoaded) return null;

  return (
    <SafeAreaView style={styles.container}>
      
      {/* ✅ Clean, Centered Header mirroring the Profile Screen */}
      <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={26} color="#D84361" />
          </TouchableOpacity>
          
          <Text style={styles.headerTitle}>Calendar</Text>
          
          {/* Dummy view to balance the flexbox and ensure absolute center alignment */}
          <View style={{ width: 36 }} /> 
      </View>

      <ScrollView style={{flex: 1, paddingHorizontal: 20}} showsVerticalScrollIndicator={false}>
        <View style={styles.calendarCard}>
            {isLoading ? (
                <ActivityIndicator style={{marginTop: 40}} size="large" color="#D84361" />
            ) : (
                <Calendar
                  markingType={'custom'}
                  markedDates={markedDates}
                  onDayPress={(day: any) => fetchDateContext(day.dateString)}
                  theme={{
                      backgroundColor: '#FFFFFF',
                      calendarBackground: '#FFFFFF',
                      textSectionTitleColor: '#8A6D72',
                      todayTextColor: '#D84361',
                      dayTextColor: '#5C4E50',
                      textDisabledColor: '#E0D4D6',
                      arrowColor: '#5C4E50',
                      monthTextColor: '#5C4E50',
                      textDayFontFamily: 'Ubuntu_400Regular',
                      textMonthFontFamily: 'SourceSerifPro_700Bold',
                      textDayHeaderFontFamily: 'Ubuntu_500Medium',
                      textMonthFontSize: 20,
                  }}
                />
            )}
        </View>

        {selectedDateData && (
            <Animated.View style={styles.contextBox}>
                <Text style={styles.contextDate}>{selectedDateData.date}</Text>
                
                {selectedDateData.empty ? (
                    <Text style={[styles.contextText, {color: '#8A6D72', fontStyle: 'italic'}]}>No scan data recorded for this day.</Text>
                ) : (
                    <Text style={styles.contextText}>{selectedDateData.heuristics}</Text>
                )}
            </Animated.View>
        )}
        <View style={{height: 40}} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F2F1', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight! + 10 : 0 },
  
  // ✅ New Header Styles applied
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, marginBottom: 10 },
  backBtn: { padding: 5 },
  headerTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 32, color: '#D84361', letterSpacing: 0.5 },
  
  calendarCard: { backgroundColor: '#FFFFFF', borderRadius: 24, paddingBottom: 15, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 10, elevation: 2, overflow: 'hidden' },
  
  contextBox: { marginTop: 20, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 25, borderWidth: 1, borderColor: '#FFE4E4', shadowColor: '#D84361', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 4 },
  contextDate: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 22, color: '#D84361', marginBottom: 15 },
  contextText: { fontFamily: 'Ubuntu_400Regular', fontSize: 15, color: '#5C4E50', lineHeight: 24 }
});