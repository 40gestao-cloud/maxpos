import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera } from 'lucide-react';

interface BarcodeScannerModalProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
}

export default function BarcodeScannerModal({ onScan, onClose }: BarcodeScannerModalProps) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let html5QrCode: Html5Qrcode;
    let initPromise: Promise<any> | null = null;

    const startScanner = async () => {
      try {
        // Solicita permissão explicitamente para forçar o aviso nativo do celular
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        // Fecha a stream manual imediatamente, pois a biblioteca vai gerenciar a sua própria
        stream.getTracks().forEach(track => track.stop());

        if (!mounted) return;
        setHasPermission(true);

        html5QrCode = new Html5Qrcode("reader");

        initPromise = html5QrCode.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          (decodedText) => {
            if (html5QrCode.isScanning) {
              html5QrCode.stop().then(() => {
                onScan(decodedText);
              }).catch(err => console.error("Failed to stop scanner", err));
            } else {
              onScan(decodedText);
            }
          },
          (errorMessage) => {
            // Ignorar erros momentâneos
          }
        );
        
        await initPromise;
      } catch (err) {
        if (!mounted) return;
        console.error("Camera permission error:", err);
        setHasPermission(false);
        setErrorMsg("Permissão negada ou câmera não encontrada. Configure o navegador.");
      }
    };

    startScanner();

    return () => {
      mounted = false;
      const cleanup = () => {
        if (html5QrCode && html5QrCode.isScanning) {
          html5QrCode.stop().then(() => {
            html5QrCode.clear();
          }).catch(console.error);
        } else if (html5QrCode) {
          html5QrCode.clear();
        }
      };

      if (initPromise) {
        initPromise.then(cleanup).catch(cleanup);
      } else {
        cleanup();
      }
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="neumorphic p-6 max-w-sm w-full bg-card space-y-4 relative animate-in zoom-in duration-300">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-black text-[#FFC107] uppercase tracking-widest leading-none flex items-center gap-2">
            <Camera size={20} /> Leitor
          </h3>
          <button 
            onClick={onClose} 
            className="text-muted-text hover:text-red-500 p-2 transition-colors ml-4"
          >
            <X size={24} />
          </button>
        </div>
        
        <div className="bg-white overflow-hidden rounded-xl relative min-h-[300px] flex items-center justify-center">
          {hasPermission === false && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-black/5 text-black">
               <Camera size={48} className="text-red-500 mb-4 opacity-50" />
               <p className="font-bold text-sm mb-2">Acesso Bloqueado</p>
               <p className="text-xs text-black/60">{errorMsg}</p>
            </div>
          )}
          {hasPermission === null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-black/5 text-black">
               <div className="w-10 h-10 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin mb-4" />
               <p className="font-bold text-sm text-black">Iniciando Câmera...</p>
               <p className="text-[10px] text-black/50 mt-2 font-black uppercase tracking-widest">Permita o acesso quando solicitado</p>
            </div>
          )}
          
          <div id="reader" style={{ width: '100%', height: hasPermission ? 'auto' : '0px', opacity: hasPermission ? 1 : 0 }} />
        </div>
        
        <p className="text-center text-[10px] text-muted-text uppercase font-black tracking-widest pt-2">
          Aponte a câmera para o código EAN
        </p>
      </div>
    </div>
  );
}
