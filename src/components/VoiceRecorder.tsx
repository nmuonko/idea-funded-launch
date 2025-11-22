import { useState, useRef } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface VoiceRecorderProps {
  onTranscription: (text: string) => void;
  language?: 'en' | 'fr' | 'sw' | 'ln';
  maxDuration?: number; // in seconds
  buttonVariant?: 'default' | 'outline' | 'ghost';
  buttonSize?: 'default' | 'sm' | 'lg' | 'icon';
}

export function VoiceRecorder({ 
  onTranscription, 
  language,
  maxDuration = 480, // 8 minutes default
  buttonVariant = 'outline',
  buttonSize = 'default'
}: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
        
        // Clean up
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const newTime = prev + 1;
          if (newTime >= maxDuration) {
            stopRecording();
          }
          return newTime;
        });
      }, 1000);

      toast({
        title: "Recording started",
        description: `Maximum duration: ${Math.floor(maxDuration / 60)} minutes`,
      });
    } catch (error) {
      console.error('Error starting recording:', error);
      toast({
        title: "Error",
        description: "Could not access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      
      await new Promise((resolve, reject) => {
        reader.onloadend = resolve;
        reader.onerror = reject;
      });

      const base64Audio = (reader.result as string).split(',')[1];

      // Call transcription edge function
      const { data, error } = await supabase.functions.invoke('transcribe-audio', {
        body: { 
          audio: base64Audio,
          language: language
        }
      });

      if (error) throw error;

      if (data?.text) {
        onTranscription(data.text);
        toast({
          title: "Transcription complete",
          description: `${data.text.length} characters transcribed`,
        });
      } else {
        throw new Error('No transcription received');
      }
    } catch (error) {
      console.error('Error transcribing audio:', error);
      toast({
        title: "Transcription failed",
        description: "Could not transcribe audio. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setRecordingTime(0);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isProcessing) {
    return (
      <Button variant={buttonVariant} size={buttonSize} disabled>
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Processing...
      </Button>
    );
  }

  if (isRecording) {
    return (
      <Button 
        variant="destructive" 
        size={buttonSize}
        onClick={stopRecording}
        className="animate-pulse"
      >
        <Square className="h-4 w-4 mr-2" />
        Stop ({formatTime(recordingTime)})
      </Button>
    );
  }

  return (
    <Button 
      variant={buttonVariant} 
      size={buttonSize}
      onClick={startRecording}
    >
      <Mic className="h-4 w-4 mr-2" />
      Record Audio
    </Button>
  );
}
