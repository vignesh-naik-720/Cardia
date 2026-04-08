import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFonts, Ubuntu_400Regular, Ubuntu_500Medium } from '@expo-google-fonts/ubuntu';
import { SourceSerifPro_700Bold } from '@expo-google-fonts/source-serif-pro';

const IP_ADDRESS = "10.179.25.130"

// --- Reusable Pill Component for Multi/Single Select ---
const Pill = ({ label, isSelected, onPress }: { label: string, isSelected: boolean, onPress: () => void }) => (
  <TouchableOpacity 
    style={[styles.pill, isSelected && styles.pillSelected]} 
    onPress={onPress}
    activeOpacity={0.7}
  >
    <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>{label}</Text>
  </TouchableOpacity>
);

// 🚀 NEW: Standard Email Regex Validator
const isValidEmail = (email: string) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export default function AuthScreen() {
  const router = useRouter();
  
  // Load Fonts
  let [fontsLoaded] = useFonts({
    Ubuntu_400Regular,
    Ubuntu_500Medium,
    SourceSerifPro_700Bold,
  });

  const [isLoading, setIsLoading] = useState(false);
  
  // Wizard State
  const [isLoginFlow, setIsLoginFlow] = useState(true);
  const [step, setStep] = useState(1);

  // Form Data
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  
  // DOB State Management
  const [dob, setDob] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dobSet, setDobSet] = useState(false); 

  const [gender, setGender] = useState('Male');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [diet, setDiet] = useState('Standard');
  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [extraInfo, setExtraInfo] = useState('');
  const [goal, setGoal] = useState('Maintain Health');
  const [customGoal, setCustomGoal] = useState('');
  
  // Options
  const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
  const DIET_OPTIONS = ['Standard', 'Vegetarian', 'Vegan', 'Keto', 'Paleo', 'Low Sodium'];
  const CONDITION_OPTIONS = ['Hypertension', 'Diabetes (Type 1)', 'Diabetes (Type 2)', 'Asthma', 'Anxiety', 'Heart Disease', 'None'];
  const ALLERGY_OPTIONS = ['Peanuts', 'Tree Nuts', 'Dairy', 'Eggs', 'Shellfish', 'Soy', 'Gluten', 'None'];
  const GOAL_OPTIONS = ['Weight Loss', 'Muscle Gain', 'Maintain Health', 'Increase Energy', 'Reduce Stress', 'Custom'];
  
  const toggleArrayItem = (item: string, array: string[], setArray: (val: string[]) => void) => {
    if (item === 'None') { setArray(['None']); return; }
    let newArr = array.filter(i => i !== 'None');
    if (newArr.includes(item)) setArray(newArr.filter(i => i !== item));
    else setArray([...newArr, item]);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios'); 
    if (selectedDate) {
      setDob(selectedDate);
      setDobSet(true);
    }
  };

  const executeLogin = async () => {
    if (!email || !password) return Alert.alert("Error", "Enter email and password.");
    
    // 🚀 NEW: Validate email format before sending
    if (!isValidEmail(email)) return Alert.alert("Invalid Email", "Please enter a valid email address.");

    setIsLoading(true);
    try {
      const response = await fetch(`http://${IP_ADDRESS}:8000/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `username=${encodeURIComponent(email.trim())}&password=${encodeURIComponent(password)}`
      });
      const data = await response.json();
      if (response.ok) {
        await AsyncStorage.setItem('userToken', data.access_token);
        router.replace('/(tabs)');
      } else Alert.alert("Login Failed", data.detail);
    } catch (error) { Alert.alert("Error", "Network error."); }
    finally { setIsLoading(false); }
  };

  // Helper to validate step 1 of signup before proceeding to step 2
  const proceedToStep2 = () => {
    if (!name || !email || !password) return Alert.alert("Missing Info", "Please fill out your Name, Email, and Password.");
    if (!isValidEmail(email)) return Alert.alert("Invalid Email", "Please enter a valid email address.");
    if (password.length < 6) return Alert.alert("Weak Password", "Password must be at least 6 characters long.");
    setStep(2);
  };

  const executeSignup = async () => {
    setIsLoading(true);
    const formattedDob = dob.toISOString().split('T')[0];
    const finalGoal = goal === 'Custom' ? customGoal : goal; 

    try {
      const response = await fetch(`http://${IP_ADDRESS}:8000/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(), password, full_name: name.trim(), dob: formattedDob, gender, height, weight,
          goal: finalGoal, diet, chronic_conditions: conditions, allergies, additional_info: extraInfo
        })
      });
      const data = await response.json();
      if (response.ok) {
        await AsyncStorage.setItem('userToken', data.access_token);
        router.replace('/(tabs)');
      } else Alert.alert("Signup Failed", data.detail);
    } catch (error) { Alert.alert("Error", "Network error."); }
    finally { setIsLoading(false); }
  };

  const renderStep1 = () => (
    <View style={styles.formContainer}>
      <View style={styles.headerRow}>
        <Image 
          source={require('../assets/images/cardia_heart.png')} 
          style={styles.headerIcon} 
          resizeMode="contain"
        />
        <Text style={styles.header}>Cardia</Text>
      </View>
      <Text style={styles.subHeader}>{isLoginFlow ? 'Welcome Back' : 'Create your secure profile'}</Text>
      
      {!isLoginFlow && <TextInput style={styles.input} placeholder="Full Name" placeholderTextColor="#A09395" value={name} onChangeText={setName} />}
      <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#A09395" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <TextInput style={styles.input} placeholder="Password" placeholderTextColor="#A09395" value={password} onChangeText={setPassword} secureTextEntry />

      {isLoginFlow ? (
        <TouchableOpacity style={styles.primaryButton} onPress={executeLogin} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Sign In</Text>}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.primaryButton} onPress={proceedToStep2}>
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => {setIsLoginFlow(!isLoginFlow); setStep(1);}} style={{marginTop: 25}}>
        <Text style={styles.switchText}>{isLoginFlow ? "New to Cardia? Let's build your profile." : "Already have an account? Sign In"}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.formContainer}>
      <Text style={styles.stepTitle}>Basic Demographics</Text>
      <Text style={styles.stepSubtitle}>To ensure clinical accuracy</Text>
      
      <Text style={styles.sectionLabel}>Date of Birth</Text>
      <TouchableOpacity style={styles.input} onPress={() => setShowDatePicker(true)}>
        <Text style={{ fontFamily: 'Ubuntu_400Regular', color: dobSet ? '#5C4E50' : '#A09395', fontSize: 16 }}>
          {dobSet ? dob.toLocaleDateString() : 'Select your birthday...'}
        </Text>
      </TouchableOpacity>
      {showDatePicker && (
        <DateTimePicker
          value={dob}
          mode="date"
          display="default"
          onChange={onDateChange}
          maximumDate={new Date()}
        />
      )}

      <Text style={styles.sectionLabel}>Gender</Text>
      <View style={styles.pillContainer}>
        {GENDER_OPTIONS.map(g => <Pill key={g} label={g} isSelected={gender === g} onPress={() => setGender(g)} />)}
      </View>
      
      <Text style={styles.sectionLabel}>Physical Stats (Optional)</Text>
      <View style={{flexDirection: 'row', justifyContent: 'space-between'}}>
        <TextInput style={[styles.input, {flex: 0.48}]} placeholder="Height (cm)" placeholderTextColor="#A09395" value={height} onChangeText={setHeight} keyboardType="numeric" />
        <TextInput style={[styles.input, {flex: 0.48}]} placeholder="Weight (kg)" placeholderTextColor="#A09395" value={weight} onChangeText={setWeight} keyboardType="numeric" />
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep(1)}><Text style={styles.secondaryText}>Back</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.primaryButton, {flex: 1, marginLeft: 10}]} onPress={() => setStep(3)}><Text style={styles.buttonText}>Next</Text></TouchableOpacity>
      </View>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.formContainer}>
      <Text style={styles.stepTitle}>Health & Dietary Profile</Text>
      <Text style={styles.stepSubtitle}>Help us personalize your advice</Text>
      
      <Text style={styles.sectionLabel}>Primary Health Goal</Text>
      <View style={styles.pillContainer}>
        {GOAL_OPTIONS.map(g => <Pill key={g} label={g} isSelected={goal === g} onPress={() => setGoal(g)} />)}
      </View>
      {goal === 'Custom' && (
        <TextInput 
          style={[styles.input, {marginTop: 5, borderColor: '#D84361'}]} 
          placeholder="Type your specific goal..." 
          placeholderTextColor="#A09395" 
          value={customGoal} 
          onChangeText={setCustomGoal} 
        />
      )}
      
      <Text style={styles.sectionLabel}>Dietary Routine</Text>
      <View style={styles.pillContainer}>
        {DIET_OPTIONS.map(d => <Pill key={d} label={d} isSelected={diet === d} onPress={() => setDiet(d)} />)}
      </View>

      <Text style={styles.sectionLabel}>Chronic Conditions</Text>
      <View style={styles.pillContainer}>
        {CONDITION_OPTIONS.map(c => <Pill key={c} label={c} isSelected={conditions.includes(c)} onPress={() => toggleArrayItem(c, conditions, setConditions)} />)}
      </View>

      <Text style={styles.sectionLabel}>Known Allergies</Text>
      <View style={styles.pillContainer}>
        {ALLERGY_OPTIONS.map(a => <Pill key={a} label={a} isSelected={allergies.includes(a)} onPress={() => toggleArrayItem(a, allergies, setAllergies)} />)}
      </View>

      <Text style={styles.sectionLabel}>Additional Medical Info (Optional)</Text>
      <TextInput 
        style={[styles.input, {height: 80, textAlignVertical: 'top'}]} 
        placeholder="Any other medications or notes?" 
        placeholderTextColor="#A09395" 
        value={extraInfo} 
        onChangeText={setExtraInfo} 
        multiline 
      />

      <View style={styles.navRow}>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep(2)} disabled={isLoading}><Text style={styles.secondaryText}>Back</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.primaryButton, {flex: 1, marginLeft: 10}]} onPress={executeSignup} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Create Profile</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  if (!fontsLoaded) return <ActivityIndicator style={{flex: 1, backgroundColor: '#FFF5F5'}} color="#D84361" />;

  return (
    <KeyboardAvoidingView style={{flex: 1}} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {!isLoginFlow && (
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} />
            </View>
        )}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#FFF5F5', justifyContent: 'center', padding: 20 },
  
  formContainer: { backgroundColor: '#FFFFFF', padding: 25, borderRadius: 24, shadowColor: '#D84361', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 6, borderWidth: 1, borderColor: '#FFE4E4' },
  
  headerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 5 },
  headerIcon: { width: 45, height: 45, marginRight: 10 },
  header: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 40, color: '#D84361', letterSpacing: 0.5 },
  subHeader: { fontFamily: 'Ubuntu_400Regular', fontSize: 16, marginBottom: 30, textAlign: 'center', color: '#8A6D72' },
  
  stepTitle: { fontFamily: 'SourceSerifPro_700Bold', fontSize: 26, color: '#D84361', marginBottom: 5 },
  stepSubtitle: { fontFamily: 'Ubuntu_400Regular', fontSize: 15, color: '#8A6D72', marginBottom: 25 },
  sectionLabel: { fontFamily: 'Ubuntu_500Medium', fontSize: 15, color: '#5C4E50', marginTop: 15, marginBottom: 10, letterSpacing: 0.3 },
  
  input: { fontFamily: 'Ubuntu_400Regular', backgroundColor: '#FFF5F5', color: '#5C4E50', padding: 16, borderRadius: 16, marginBottom: 15, borderWidth: 1, borderColor: '#FFE4E4', fontSize: 16 },
  
  primaryButton: { backgroundColor: '#D84361', padding: 18, borderRadius: 16, alignItems: 'center', marginTop: 15, shadowColor: '#D84361', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  secondaryButton: { backgroundColor: '#FFFFFF', padding: 18, borderRadius: 16, alignItems: 'center', marginTop: 15, borderWidth: 1.5, borderColor: '#D84361', width: '30%' },
  buttonText: { fontFamily: 'Ubuntu_500Medium', color: 'white', fontSize: 17, letterSpacing: 0.5 },
  secondaryText: { fontFamily: 'Ubuntu_500Medium', color: '#D84361', fontSize: 17 },
  switchText: { fontFamily: 'Ubuntu_500Medium', color: '#D84361', textAlign: 'center', fontSize: 15 },
  
  navRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  
  pillContainer: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, margin: 5, borderWidth: 1, borderColor: '#FFE4E4' },
  pillSelected: { backgroundColor: '#FFD9D9', borderColor: '#D84361', borderWidth: 1.5 },
  pillText: { fontFamily: 'Ubuntu_400Regular', color: '#8A6D72' },
  pillTextSelected: { fontFamily: 'Ubuntu_500Medium', color: '#D84361' },
  
  progressBar: { height: 8, backgroundColor: '#FFE4E4', borderRadius: 4, marginBottom: 30, width: '100%' },
  progressFill: { height: '100%', backgroundColor: '#D84361', borderRadius: 4 }
});