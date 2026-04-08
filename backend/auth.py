from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
import bcrypt

# In production, make this a long random string in your .env file
SECRET_KEY = "cardia_super_secret_dev_key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # Tokens last for 7 days

def verify_password(plain_password: str, hashed_password: str) -> bool:
    password_bytes = plain_password.encode('utf-8')
    hashed_password_bytes = hashed_password.encode('utf-8')
    
    # Safely check the password against the hash
    try:
        return bcrypt.checkpw(password_bytes, hashed_password_bytes)
    except ValueError:
        return False

def get_password_hash(password: str) -> str:
    password_bytes = password.encode('utf-8')
    
    # Enforce the strict 72-byte limit to prevent the bcrypt ValueError
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
        
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password_bytes, salt)
    
    # Return as a string to easily store in PostgreSQL
    return hashed_password.decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt