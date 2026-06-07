import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Platform, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useFonts, Ubuntu_400Regular, Ubuntu_500Medium } from '@expo-google-fonts/ubuntu';
import { SourceSerifPro_700Bold } from '@expo-google-fonts/source-serif-pro';

const IP_ADDRESS = "https://purposely-ozone-enjoying.ngrok-free.dev";

const Pill = ({ label, isSelected, onPress, disabled }: { label: string, isSelected: boolean, onPress: () => void, disabled: boolean }) => (
  <TouchableOpacity 
    style={[styles.pill, isSelected && styles.pillSelected, disabled && { opacity: 0.8 }]} 
    onPress={onPress}
    activeOpacity={disabled ? 1 : 0.7}
    disabled={disabled}
  >
    <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>{label}</Text>
  </TouchableOpacity>
);

export default function ProfileScreen() {
  const router = useRouter();
  
  let [fontsLoaded] = useFonts({
    Ubuntu_400Regular,
    Ubuntu_500Medium,
    SourceSerifPro_700Bold,
  });

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customGoal, setCustomGoal] = useState('');

  const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
  
  // Expanded Options to match AuthScreen
  const DIET_OPTIONS = ['Standard', 'Vegetarian', 'Vegan', 'Keto', 'Paleo', 'Mediterranean', 'Pescetarian', 'DASH', 'Low Sodium'];
  const CONDITION_OPTIONS = ['Hypertension', 'High Cholesterol', 'Diabetes (Type 1)', 'Diabetes (Type 2)', 'Asthma', 'Anxiety', 'Heart Disease', 'PCOS', 'IBS', 'Celiac Disease', 'None'];
  const ALLERGY_OPTIONS = ['Peanuts', 'Tree Nuts', 'Dairy', 'Eggs', 'Shellfish', 'Fish', 'Soy', 'Gluten', 'Wheat', 'Sesame', 'None'];
  const GOAL_OPTIONS = ['Weight Loss', 'Muscle Gain', 'Maintain Health', 'Increase Energy', 'Reduce Stress', 'Improve Sleep', 'Custom'];

  useEffect(() => { loadProfile(); }, []);

  const loadProfile = async () => {
    const token = await AsyncStorage.getItem('userToken');
    try {
      const res = await fetch(`${IP_ADDRESS}/api/auth/profile`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (!data.chronic_conditions) data.chronic_conditions = [];
      if (!data.allergies) data.allergies = [];
      
      // 🚀 Parse the backend goal string into an array of up to 3 goals
      let rawGoal = data.goal || 'Maintain Health';
      let parsedGoals = rawGoal.split(',').map((g: string) => g.trim());
      let activePills: string[] = [];
      let foundCustom = '';

      parsedGoals.forEach((g: string) => {
          if (GOAL_OPTIONS.includes(g) && g !== 'Custom') {
              activePills.push(g);
          } else if (g) {
              activePills.push('Custom');
              foundCustom = g;
          }
      });
      
      setCustomGoal(foundCustom);
      data.activeGoalPills = activePills; // UI tracker for multiple pills
      
      setProfile(data);
    } catch (e) { Alert.alert("Error", "Could not load profile."); }
    finally { setLoading(false); }
  };

  const handleUpdate = async () => {
    if (profile.activeGoalPills.length === 0) return Alert.alert("Missing Info", "Please select at least one health goal.");

    setSaving(true);
    const token = await AsyncStorage.getItem('userToken');
    
    const payload = { ...profile };
    
    // Compile multiple goals into a single comma-separated string
    const finalGoalsString = (payload.activeGoalPills || [])
      .map((g: string) => g === 'Custom' ? customGoal.trim() : g)
      .filter((g: string) => g !== '')
      .join(', ');

    payload.goal = finalGoalsString;
    delete payload.activeGoalPills; // Clean up UI tracker

    try {
      const res = await fetch(`${IP_ADDRESS}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
          Alert.alert("Success", "Profile Updated Successfully!");
          setProfile({...profile, goal: payload.goal}); 
          setIsEditing(false); 
      }
    } catch (e) { Alert.alert("Error", "Failed to save profile."); }
    finally { setSaving(false); }
  };

  const toggleGoal = (selectedGoal: string) => {
      if (!isEditing) return;
      let currentGoals = profile.activeGoalPills || [];
      if (currentGoals.includes(selectedGoal)) {
          setProfile({ ...profile, activeGoalPills: currentGoals.filter((g: string) => g !== selectedGoal) });
      } else {
          if (currentGoals.length >= 3) {
              Alert.alert("Limit Reached", "You can select a maximum of 3 health goals.");
              return;
          }
          setProfile({ ...profile, activeGoalPills: [...currentGoals, selectedGoal] });
      }
  };

  const toggleArrayItem = (item: string, arrayKey: 'chronic_conditions' | 'allergies') => {
    if (!isEditing) return;
    let currentArray = profile[arrayKey] || [];
    if (item === 'None') { setProfile({ ...profile, [arrayKey]: ['None'] }); return; }
    let newArr = currentArray.filter((i: string) => i !== 'None');
    if (newArr.includes(item)) newArr = newArr.filter((i: string) => i !== item);
    else newArr = [...newArr, item];
    setProfile({ ...profile, [arrayKey]: newArr });
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios'); 
    if (selectedDate) {
      const formattedDob = selectedDate.toISOString().split('T')[0];
      setProfile({ ...profile, dob: formattedDob });
    }
  };

  if (!fontsLoaded || loading || !profile) return <ActivityIndicator style={{flex: 1, backgroundColor: '#FFF5F5'}} size="large" color="#D84361" />;

  const ReadOnlyField = ({ label, value }: { label: string, value: string | string[] }) => {
      const displayValue = Array.isArray(value) ? value.join(', ') : value;
      return (
          <View style={styles.readOnlyContainer}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.readOnlyText}>{displayValue || 'Not provided'}</Text>
          </View>
      );
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      
      {/* Header Row */}
      <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.replace('/(tabs)' as any)} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={26} color="#D84361" />
          </TouchableOpacity>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text style={styles.header}>Profile</Text>
          </View>
          {!isEditing ? (
              <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.editIconBtn}>
                  <Ionicons name="pencil" size={22} color="#D84361" />
              </TouchableOpacity>
          ) : (
              <TouchableOpacity onPress={() => setIsEditing(false)} style={styles.editIconBtn}>
                  <Ionicons name="close" size={26} color="#8A6D72" />
              </TouchableOpacity>
          )}
      </View>
      
      <Text style={[styles.label, {marginTop: 0}]}>Account Email (Cannot be changed)</Text>
      <TextInput style={[styles.input, {backgroundColor: '#F9F1F2', color: '#A09395'}]} value={profile.email} editable={false} />

      {isEditing ? (
          <View style={styles.editContainer}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput style={styles.input} value={profile.full_name} onChangeText={(t) => setProfile({...profile, full_name: t})} />

            <Text style={styles.label}>Date of Birth</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
              <Text style={{ fontFamily: 'Ubuntu_400Regular', color: '#5C4E50', fontSize: 16 }}>{profile.dob || 'Select Date'}</Text>
            </TouchableOpacity>
            {showDatePicker && <DateTimePicker value={profile.dob ? new Date(profile.dob) : new Date()} mode="date" display="default" onChange={onDateChange} maximumDate={new Date()} />}

            <Text style={styles.label}>Gender</Text>
            <View style={styles.pillContainer}>
              {GENDER_OPTIONS.map(g => <Pill key={g} label={g} isSelected={profile.gender === g} disabled={false} onPress={() => setProfile({...profile, gender: g})} />)}
            </View>

            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 5}}>
              <View style={{flex: 0.48}}>
                  <Text style={styles.label}>Height (cm)</Text>
                  <TextInput style={styles.input} value={profile.height?.toString()} onChangeText={(t) => setProfile({...profile, height: t})} keyboardType="numeric"/>
              </View>
              <View style={{flex: 0.48}}>
                  <Text style={styles.label}>Weight (kg)</Text>
                  <TextInput style={styles.input} value={profile.weight?.toString()} onChangeText={(t) => setProfile({...profile, weight: t})} keyboardType="numeric"/>
              </View>
            </View>

            {/* 🚀 NEW: Multi-Select Health Goals UI */}
            <Text style={styles.label}>Primary Health Goals (Select up to 3)</Text>
            <View style={styles.pillContainer}>
              {GOAL_OPTIONS.map(g => (
                <Pill 
                  key={g} 
                  label={g} 
                  disabled={false}
                  isSelected={(profile.activeGoalPills || []).includes(g)} 
                  onPress={() => toggleGoal(g)} 
                />
              ))}
            </View>
            {(profile.activeGoalPills || []).includes('Custom') && (
              <TextInput 
                 style={[styles.input, {marginTop: 5, borderColor: '#D84361'}]} 
                 value={customGoal} 
                 onChangeText={setCustomGoal} 
                 placeholder="Type your specific goal..." 
                 placeholderTextColor="#A09395"
              />
            )}
            
            <Text style={styles.label}>Dietary Routine</Text>
            <View style={styles.pillContainer}>
              {DIET_OPTIONS.map(d => <Pill key={d} label={d} isSelected={profile.diet === d} disabled={false} onPress={() => setProfile({...profile, diet: d})} />)}
            </View>

            <Text style={styles.label}>Chronic Conditions</Text>
            <View style={styles.pillContainer}>
              {CONDITION_OPTIONS.map(c => <Pill key={c} label={c} isSelected={profile.chronic_conditions.includes(c)} disabled={false} onPress={() => toggleArrayItem(c, 'chronic_conditions')} />)}
            </View>

            <Text style={styles.label}>Known Allergies</Text>
            <View style={styles.pillContainer}>
              {ALLERGY_OPTIONS.map(a => <Pill key={a} label={a} isSelected={profile.allergies.includes(a)} disabled={false} onPress={() => toggleArrayItem(a, 'allergies')} />)}
            </View>

            <Text style={styles.label}>Additional Medical Notes</Text>
            <TextInput style={[styles.input, {height: 90, textAlignVertical: 'top'}]} value={profile.additional_info} onChangeText={(t) => setProfile({...profile, additional_info: t})} multiline/>

            <TouchableOpacity style={styles.saveBtn} onPress={handleUpdate} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff"/> : <Text style={styles.btnText}>Save Updates</Text>}
            </TouchableOpacity>
          </View>
      ) : (
          <View style={styles.readOnlyWrapper}>
            <ReadOnlyField label="Full Name" value={profile.full_name} />
            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                <View style={{flex: 0.48}}><ReadOnlyField label="Date of Birth" value={profile.dob} /></View>
                <View style={{flex: 0.48}}><ReadOnlyField label="Gender" value={profile.gender} /></View>
            </View>
            <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
                <View style={{flex: 0.48}}><ReadOnlyField label="Height" value={profile.height ? `${profile.height} cm` : 'N/A'} /></View>
                <View style={{flex: 0.48}}><ReadOnlyField label="Weight" value={profile.weight ? `${profile.weight} kg` : 'N/A'} /></View>
            </View>
            
            <ReadOnlyField label="Primary Health Goals" value={profile.goal || 'Not set'} />

            <ReadOnlyField label="Dietary Routine" value={profile.diet} />
            <ReadOnlyField label="Chronic Conditions" value={profile.chronic_conditions?.length ? profile.chronic_conditions : 'None'} />
            <ReadOnlyField label="Known Allergies" value={profile.allergies?.length ? profile.allergies : 'None'} />
            <ReadOnlyField label="Additional Medical Notes" value={profile.additional_info || 'No additional notes provided.'} />
          </View>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 25, backgroundColor: '#FFF5F5', flexGrow: 1, paddingTop: 60, paddingBottom: 40 },
  
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  backBtn: { padding: 5 },
  headerLogo: { width: 30, height: 30, marginRight: 10 },
  header: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 32, color: '#D84361', letterSpacing: 0.5 },
  editIconBtn: { padding: 10, backgroundColor: '#FFE4E4', borderRadius: 20 },
  
  label: { fontFamily: 'Ubuntu_500Medium', fontSize: 14, color: '#8A6D72', marginTop: 15, marginBottom: 8, letterSpacing: 0.5 },
  input: { fontFamily: 'Ubuntu_400Regular', backgroundColor: '#FFFFFF', color: '#5C4E50', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#FFE4E4', fontSize: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 5, elevation: 2 },
  
  editContainer: { marginTop: 10 },
  
  readOnlyWrapper: { marginTop: 5 },
  readOnlyContainer: { backgroundColor: '#FFFFFF', padding: 18, borderRadius: 16, borderWidth: 1, borderColor: '#FFE4E4', marginTop: 15, shadowColor: '#D84361', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  readOnlyText: { fontFamily: 'Ubuntu_500Medium', fontSize: 16, color: '#5C4E50', marginTop: 4 },

  saveBtn: { backgroundColor: '#D84361', padding: 18, borderRadius: 16, alignItems: 'center', marginTop: 35, shadowColor: '#D84361', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 5 },
  btnText: { fontFamily: 'Ubuntu_500Medium', color: '#FFF', fontSize: 18, letterSpacing: 0.5 },
  
  pillContainer: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 5 },
  pill: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, margin: 5, borderWidth: 1, borderColor: '#FFE4E4' },
  pillSelected: { backgroundColor: '#FFD9D9', borderColor: '#D84361', borderWidth: 1.5 },
  pillText: { fontFamily: 'Ubuntu_400Regular', color: '#8A6D72' },
  pillTextSelected: { fontFamily: 'Ubuntu_500Medium', color: '#D84361' },
});
