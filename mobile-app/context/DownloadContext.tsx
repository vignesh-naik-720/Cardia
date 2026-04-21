// mobile-app/context/DownloadContext.tsx
import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { File, Paths } from 'expo-file-system';

interface DownloadContextType {
    isDownloading: boolean;
    isDownloaded: boolean;
    startDownload: () => Promise<void>;
    cancelDownload: () => Promise<void>;
    resetDownloadState: () => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

const HF_MODEL_URL = 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf';
export const MODEL_FILENAME = 'qwen_melio_q4.gguf';
const MIN_VALID_BYTES = 970 * 1024 * 1024 * 0.9;

export const DownloadProvider: React.FC<{children: React.ReactNode}> = ({ children }) => {
    const [isDownloading, setIsDownloading] = useState(false);
    const [isDownloaded, setIsDownloaded] = useState(false);
    
    const isCancelledRef = useRef(false);

    useEffect(() => {
        checkFile();
    }, []);

    const getModelFile = () => new File(Paths.document, MODEL_FILENAME);

    const checkFile = async () => {
        try {
            const file = getModelFile();
            if (file.exists && file.size > MIN_VALID_BYTES) {
                setIsDownloaded(true);
            } else if (file.exists) {
                await file.delete();
                setIsDownloaded(false);
            }
        } catch (e) {
            console.log("Error checking file:", e);
        }
    };

    const startDownload = async () => {
        if (isDownloading || isDownloaded) return;
        
        setIsDownloading(true);
        isCancelledRef.current = false;
        const file = getModelFile();

        try {
                   await File.downloadFileAsync(HF_MODEL_URL, file);
        
            if (isCancelledRef.current) {
                if (file.exists) await file.delete();
                setIsDownloaded(false);
            } else {
                setIsDownloaded(true);
            }
        } catch (e) {
            console.log("Download interrupted:", e);
        } finally {
            setIsDownloading(false);
        }
    };

    const cancelDownload = async () => {
        isCancelledRef.current = true;
        setIsDownloading(false);
        try {
            const file = getModelFile();
            if (file.exists) await file.delete();
        } catch (e) {
            console.error("Failed to delete cancelled file:", e);
        }
    };

    const resetDownloadState = () => {
        setIsDownloaded(false);
        setIsDownloading(false);
        isCancelledRef.current = false;
    };

    return (
        <DownloadContext.Provider value={{ isDownloading, isDownloaded, startDownload, cancelDownload, resetDownloadState }}>
            {children}
        </DownloadContext.Provider>
    );
};

export const useDownload = () => {
    const context = useContext(DownloadContext);
    if (!context) throw new Error("useDownload must be used within a DownloadProvider");
    return context;
};