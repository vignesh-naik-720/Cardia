import chromadb
from chromadb.utils import embedding_functions
import uuid
import time

chroma_client = chromadb.PersistentClient(path="./chroma_db_storage")
sentence_transformer_ef = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="all-MiniLM-L6-v2")

collection = chroma_client.get_or_create_collection(
    name="abstract_cache",
    embedding_function=sentence_transformer_ef,
    metadata={"hnsw:space": "cosine"}
)

MAX_CACHE_SIZE = 5000 

def enforce_cache_limit():
    if collection.count() > MAX_CACHE_SIZE:
        results = collection.get(include=["metadatas"])
        if results['ids']:
            sorted_docs = sorted(zip(results['ids'], results['metadatas']), key=lambda x: x[1].get('timestamp', 0))
            ids_to_delete = [doc[0] for doc in sorted_docs[:500]]
            collection.delete(ids=ids_to_delete)
            print("🧹 Cache memory limit reached. Cleared 500 oldest abstracts.")

def save_abstract(user_question: str, medical_abstract: str):
    enforce_cache_limit()
    unique_id = str(uuid.uuid4())
    
    collection.add(
        documents=[user_question], 
        metadatas=[{"abstract": medical_abstract, "timestamp": int(time.time())}], 
        ids=[unique_id]
    )
    print(f"✅ Saved abstract to ChromaDB for: {user_question}")

def search_similar_abstracts(query: str, similarity_threshold: float = 0.4):
    if collection.count() == 0: 
        return None
        
    results = collection.query(
        query_texts=[query],
        n_results=1,
        include=["documents", "distances", "metadatas"]
    )
    
    if not results['documents'] or not results['documents'][0]: 
        return None
        
    distance = results['distances'][0][0]
    
    if distance < similarity_threshold:
        matched_abstract = results['metadatas'][0][0]['abstract']
        return matched_abstract
        
    return None