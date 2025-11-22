import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, Download, Play, Trash2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';

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
  maxDuration = 300, // 5 minutes default
  buttonVariant = 'outline',
  buttonSize = 'default'
}: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState<{ blob: Blob; url: string } | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (recordedAudio) {
        URL.revokeObjectURL(recordedAudio.url);
      }
    };
  }, [recordedAudio]);

  const visualizeAudio = (stream: MediaStream) => {
    audioContextRef.current = new AudioContext();
    analyserRef.current = audioContextRef.current.createAnalyser();
    const source = audioContextRef.current.createMediaStreamSource(stream);
    
    analyserRef.current.fftSize = 256;
    source.connect(analyserRef.current);

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateWaveform = () => {
      if (!analyserRef.current || !isRecording) return;

      analyserRef.current.getByteFrequencyData(dataArray);
      const normalizedData = Array.from(dataArray.slice(0, 32)).map(value => value / 255);
      setWaveformData(normalizedData);

      animationRef.current = requestAnimationFrame(updateWaveform);
    };

    updateWaveform();
  };

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

      // Start waveform visualization
      visualizeAudio(stream);

      // Try supported MIME types in order of preference
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus'
      ];
      
      let selectedMimeType = mimeTypes[0];
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: selectedMimeType });
        const audioUrl = URL.createObjectURL(audioBlob);
        setRecordedAudio({ blob: audioBlob, url: audioUrl });
        
        // Clean up stream and visualization
        stream.getTracks().forEach(track => track.stop());
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
        setWaveformData([]);
      };

      // Request data every second for better chunking
      mediaRecorder.start(1000);
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

  const playRecording = () => {
    if (!recordedAudio) return;

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
      setIsPlaying(false);
      return;
    }

    const audio = new Audio(recordedAudio.url);
    audioPlayerRef.current = audio;
    
    audio.onended = () => {
      setIsPlaying(false);
      audioPlayerRef.current = null;
    };

    audio.play();
    setIsPlaying(true);
  };

  const downloadRecording = () => {
    if (!recordedAudio) return;

    const link = document.createElement('a');
    link.href = recordedAudio.url;
    link.download = `recording_${new Date().getTime()}.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Download started",
      description: "Your recording is being downloaded",
    });
  };

  const deleteRecording = () => {
    if (recordedAudio) {
      URL.revokeObjectURL(recordedAudio.url);
      setRecordedAudio(null);
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
      setIsPlaying(false);
    }
    setRecordingTime(0);
  };

  const transcribeAudio = async () => {
    if (!recordedAudio) return;
    const audioBlob = recordedAudio.blob;
    // Check minimum recording duration
    if (recordingTime < 1) {
      toast({
        title: "Recording too short",
        description: "Please record for at least 1 second.",
        variant: "destructive",
      });
      return;
    }

    // Check if blob has data
    if (audioBlob.size < 1000) {
      toast({
        title: "Recording too short or empty",
        description: "Please try recording again.",
        variant: "destructive",
      });
      return;
    }

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
          language: language,
          mimeType: audioBlob.type
        }
      });

      if (error) throw error;

      if (data?.text) {
        onTranscription(data.text);
        deleteRecording(); // Clean up after successful transcription
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
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (recordedAudio) {
    return (
      <Card className="p-4 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Recording ready ({formatTime(recordingTime)})</span>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={playRecording}
            disabled={isProcessing}
          >
            <Play className={`h-4 w-4 mr-2 ${isPlaying ? 'animate-pulse' : ''}`} />
            {isPlaying ? 'Playing...' : 'Play'}
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={downloadRecording}
            disabled={isProcessing}
          >
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={deleteRecording}
            disabled={isProcessing}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
          
          <Button
            variant="default"
            size="sm"
            onClick={transcribeAudio}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Transcribe
              </>
            )}
          </Button>
        </div>
      </Card>
    );
  }

  if (isRecording) {
    return (
      <Card className="p-4 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Recording... ({formatTime(recordingTime)})</span>
          <Button 
            variant="destructive" 
            size="sm"
            onClick={stopRecording}
          >
            <Square className="h-4 w-4 mr-2" />
            Stop
          </Button>
        </div>
        
        {/* Waveform Visualization */}
        <div className="flex items-center justify-center gap-1 h-16 bg-muted rounded-lg p-2">
          {waveformData.map((value, index) => (
            <div
              key={index}
              className="flex-1 bg-primary rounded-full transition-all duration-100 animate-pulse"
              style={{
                height: `${Math.max(10, value * 100)}%`,
                opacity: 0.6 + value * 0.4,
              }}
            />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Button 
      variant={buttonVariant} 
      size={buttonSize}
      onClick={startRecording}
    >
      <Mic className="h-4 w-4 mr-2" />
      Record Audio (Max {Math.floor(maxDuration / 60)} min)
    </Button>
  );
}
