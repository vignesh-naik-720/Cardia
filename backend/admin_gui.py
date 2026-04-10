import streamlit as st
import chromadb
import pandas as pd
from datetime import datetime

# 1. Page Setup
st.set_page_config(page_title="Cardia DB Admin", layout="wide")
st.title("🧠 Cardia Vector DB Admin Panel")

# 2. Connect to your existing ChromaDB folder
@st.cache_resource
def get_collection():
    client = chromadb.PersistentClient(path="./chroma_db_storage")
    try:
        return client.get_collection(name="abstract_cache")
    except Exception:
        return None

collection = get_collection()

if collection is None:
    st.error("Database not found. Run a scan in the app first to generate data!")
    st.stop()

# 3. Fetch all data
data = collection.get(include=["documents", "metadatas"])

if not data['ids']:
    st.info("The Vector Database is currently empty.")
else:
    st.subheader(f"Total Cached Abstracts: {len(data['ids'])}")
    
    # 4. Format the data into a Pandas Table
    formatted_data = []
    for i in range(len(data['ids'])):
        # Convert the Unix timestamp back to a readable date
        raw_time = data["metadatas"][i].get("timestamp", 0)
        readable_time = datetime.fromtimestamp(raw_time).strftime('%Y-%m-%d %H:%M:%S') if raw_time else "Unknown"
        
        formatted_data.append({
            "ID": data["ids"][i],
            "Saved On": readable_time,
            "User Question": data["documents"][i], # Mapped to the new document structure
            "Medical Abstract": data["metadatas"][i].get("abstract", "No abstract found") # Mapped to the new metadata structure
        })
        
    df = pd.DataFrame(formatted_data)
    
    # 5. Render the Interactive GUI Table
    # Users can sort columns, expand rows, and scroll through the text!
    st.dataframe(df, use_container_width=True, hide_index=True)
    
    st.divider()
    
    # 6. GUI Deletion Controls
    st.subheader("🛠️ Manage Database")
    col1, col2 = st.columns(2)
    
    with col1:
        st.markdown("**Surgical Delete**")
        del_id = st.text_input("Paste an ID from the table above to delete it:")
        if st.button("Delete Specific Row"):
            if del_id:
                try:
                    collection.delete(ids=[del_id])
                    st.success(f"Row {del_id} deleted successfully!")
                    st.rerun() # Refresh the page instantly
                except Exception as e:
                    st.error(f"Error deleting row: {e}")
            else:
                st.warning("Please paste an ID first.")
                
    with col2:
        st.markdown("**Nuclear Option**")
        st.write("This will wipe all cached memory. Cardia will have to re-fetch from PubMed.")
        if st.button("🚨 Clear Entire Database", type="primary"):
            # Delete all IDs currently in the database
            collection.delete(ids=data['ids'])
            st.success("Database completely wiped!")
            st.rerun()