import { useCallback, useEffect, useRef, useState } from "react";
import { Video, VideoOff, Mic, MicOff, PhoneOff, Send, MessageSquare, BookOpenCheck, Loader2, X, Star, TrendingUp, AlertCircle, Lightbulb } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { summarizeEmotions } from "@/lib/emotion";
import { errorMessage } from "@/lib/errors";
import { serviceAuthHeaders } from "@/lib/serviceToken";
import { invalidate, queryKeys } from "@/lib/queries";
import { analyzeVoice, prepareVoiceAnalysis, releaseVoiceAnalysis } from "@/lib/voice";
import type { EmotionResult, EmotionSummary } from "@/types";



const API_BASE_URL = import.meta.env.VITE_INTERVIEW_API;
const BACKEND_URL = import.meta.env.VITE_API_BASE_URL;
const EMOTION_WAIT_MS = 8000;

// Define the state for the interview session
type InterviewState = "initial" | "waiting_intro" | "in_interview" | "completed";

// Define the structure for the interviewer's response
interface InterviewResponse {
    error?: string;
    session_id: string;
    response: string;
    state: InterviewState;
    action: "new_question" | "end_interview";
    questions_count?: number;
    audio_url?: string;
}

// Define the structure for the conversation messages (for display)
interface ChatMessage {
    sender: "user" | "interviewer";
    text: string;
    // "status" is a note from the page itself. It is not part of the interview.
    type: "intro" | "answer" | "question" | "status";
}

// Define the structure for the final feedback
interface Feedback {
    overall_rating: number | string;
    summary: string;
    strengths: string[];
    areas_for_improvement: string[];
    recommended_next_steps: string[];
    emotion_analysis?: EmotionSummary;
}


// --- Component for Feedback Modal (Internal) ---
const FeedbackModal: React.FC<{ feedback: Feedback, onClose: () => void }> = ({ feedback, onClose }) => {
    const rating = Number(feedback.overall_rating) || 0;
    const ratingColor = rating >= 8 ? "text-green-600" : rating >= 5 ? "text-yellow-600" : "text-red-500";
    const ratingRing = rating >= 8 ? "border-green-200 bg-green-50" : rating >= 5 ? "border-yellow-200 bg-yellow-50" : "border-red-200 bg-red-50";

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.14)] w-full max-w-2xl max-h-[88vh] flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 shrink-0">
                    <div className="flex items-center gap-2">
                        <BookOpenCheck className="h-5 w-5 text-gray-700" />
                        <h2 className="text-lg font-semibold text-gray-800">Interview Feedback</h2>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition">
                        <X className="h-5 w-5 text-gray-500" />
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">

                    {/* Rating + Summary row */}
                    <div className="flex gap-4">
                        <div className={`flex flex-col items-center justify-center rounded-2xl border-2 ${ratingRing} p-5 shrink-0 w-32`}>
                            <span className={`text-4xl font-bold ${ratingColor}`}>{feedback.overall_rating}</span>
                            <span className="text-[10px] text-gray-400 mt-1 font-medium uppercase tracking-wide">/ 10</span>
                        </div>
                        <div className="flex-1 bg-gray-50 border border-gray-200 rounded-2xl p-4 flex flex-col justify-center">
                            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Summary</p>
                            <p className="text-sm text-gray-700 leading-relaxed">{feedback.summary}</p>
                        </div>
                    </div>

                    {/* Strengths + Areas */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white border border-gray-200 rounded-2xl p-4">
                            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
                                <TrendingUp className="h-4 w-4 text-green-500" /> Strengths
                            </div>
                            <ul className="flex flex-col gap-1.5">
                                {feedback.strengths?.map((s, i) => (
                                    <li key={i} className="text-xs text-gray-600 flex gap-2 leading-snug">
                                        <span className="text-green-500 shrink-0 mt-0.5">•</span> {s}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="bg-white border border-gray-200 rounded-2xl p-4">
                            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
                                <AlertCircle className="h-4 w-4 text-red-400" /> Areas to Improve
                            </div>
                            <ul className="flex flex-col gap-1.5">
                                {feedback.areas_for_improvement?.map((a, i) => (
                                    <li key={i} className="text-xs text-gray-600 flex gap-2 leading-snug">
                                        <span className="text-red-400 shrink-0 mt-0.5">•</span> {a}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Next Steps */}
                    {feedback.recommended_next_steps?.length > 0 && (
                        <div className="bg-white border border-gray-200 rounded-2xl p-4">
                            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
                                <Lightbulb className="h-4 w-4 text-yellow-500" /> Recommended Next Steps
                            </div>
                            <ul className="flex flex-col gap-1.5">
                                {feedback.recommended_next_steps.map((r, i) => (
                                    <li key={i} className="text-xs text-gray-600 flex gap-2 leading-snug">
                                        <span className="text-yellow-500 shrink-0 mt-0.5">•</span> {r}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Emotion Analysis */}
                    {feedback.emotion_analysis && (
                        <div className="bg-white border border-gray-200 rounded-2xl p-4">
                            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700">
                                <Star className="h-4 w-4 text-purple-400" /> Voice Emotion Analysis
                            </div>
                            <div className="flex flex-col gap-1 text-xs text-gray-600">
                                {feedback.emotion_analysis.speaking_style && (
                                    <p><span className="font-medium text-gray-700">Speaking Style:</span> {feedback.emotion_analysis.speaking_style.label} ({(feedback.emotion_analysis.speaking_style.score * 100).toFixed(1)}%)</p>
                                )}
                                {feedback.emotion_analysis.emotions_3 && (
                                    <p><span className="font-medium text-gray-700">Primary Emotion:</span> {feedback.emotion_analysis.emotions_3.emotion}</p>
                                )}
                                {feedback.emotion_analysis.emotions_6 && (
                                    <p><span className="font-medium text-gray-700">Detailed Emotion:</span> {feedback.emotion_analysis.emotions_6.emotion}</p>
                                )}
                                <p className="text-gray-400 mt-1">
                                    Averaged over {feedback.emotion_analysis.answers} recorded {feedback.emotion_analysis.answers === 1 ? "answer" : "answers"}. It does not affect your score.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-black text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};



interface SimulationState {
    company: string;
    role: string;
    jobDescription: string;
    level: string;
    duration: string;
    interviewType: string;
    resume: unknown;
    jdId?: string;
    resumeId?: string;
}

/** Pairs each answer with the question it replied to. */
const buildTranscript = (msgs: ChatMessage[]) => {
    const qa: { question: string; answer: string }[] = [];
    let question = "";
    for (const msg of msgs) {
        if (msg.sender === "interviewer") {
            if (msg.type === "question") question = msg.text;
        } else if (msg.type === "intro") {
            qa.push({ question: "Introduce yourself", answer: msg.text });
        } else if (question) {
            qa.push({ question, answer: msg.text });
            question = "";
        }
    }
    return qa;
};

export default function WebinarUI() {
    const location = useLocation();
    const state = location.state as SimulationState | null;

    const navigate = useNavigate();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chatEndRef = useRef<HTMLDivElement | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const emotionsRef = useRef<EmotionResult[]>([]);
    const pendingEmotionsRef = useRef<Promise<unknown>[]>([]);
    const feedbackInFlightRef = useRef(false);

    // --- State for Media and UI ---
    const [hasMedia, setHasMedia] = useState(false);
    const [audioEnabled] = useState(true);
    const [videoEnabled, setVideoEnabled] = useState(true);
    const [permissionError, setPermissionError] = useState<string | null>(null);
    const [liveTime, setLiveTime] = useState(0); // seconds
    const liveIntervalRef = useRef<number | null>(null);
    const [currentTime, setCurrentTime] = useState(new Date());

    // --- NEW State for Recording and Transcription ---
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);

    // --- State for Interview Logic ---
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [interviewState, setInterviewState] = useState<InterviewState>("initial");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [isProcessing, setIsProcessing] = useState(false);
    const [feedback, setFeedback] = useState<Feedback | null>(null);
    const [showFeedbackModal, setShowFeedbackModal] = useState(false); // New state for modal

    // --- Time Formatting Helper ---
    const formatTime = (s: number) => {
        const hrs = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        const secs = s % 60;
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    // The voice analysis worker holds the model and the resampler. Free them when the page closes.
    useEffect(() => releaseVoiceAnalysis, []);

    // --- Media Setup and Cleanup (Initial useEffect) ---
    useEffect(() => {
        let left = false;

        const initMedia = async () => {
            try {
                // Request both video and audio access
                const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                if (left) {
                    // The page was closed while the permission prompt was open.
                    s.getTracks().forEach(t => t.stop());
                    return;
                }
                streamRef.current = s;

                // Attach the stream to the video element
                if (videoRef.current) {
                    videoRef.current.srcObject = s;
                    videoRef.current.play().catch(e => console.warn("Camera preview did not play:", e));
                }
                setHasMedia(true);
                setPermissionError(null);
            } catch (err) {
                console.error("Media access error:", err);
                setPermissionError(errorMessage(err, "Permission denied. Check your browser settings."));
            }
        };

        initMedia();

        // Cleanup: Stop all media tracks when the component unmounts
        return () => {
            left = true;
            if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
            if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
            if (recorderRef.current) {
                // Leaving the page discards an unfinished recording.
                recorderRef.current.onstop = null;
                if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
                recorderRef.current = null;
            }
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    // --- Timer and Current Time Effects ---
    useEffect(() => {
        // Live time counter
        if (videoEnabled && hasMedia) {
            if (!liveIntervalRef.current) {
                liveIntervalRef.current = window.setInterval(() => {
                    setLiveTime(prev => prev + 1);
                }, 1000);
            }
        } else {
            if (liveIntervalRef.current) {
                clearInterval(liveIntervalRef.current);
                liveIntervalRef.current = null;
            }
        }
    }, [videoEnabled, hasMedia]);

    useEffect(() => {
        // Clock
        const interval = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // --- Chat Auto-Scroll Effect ---
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);


    // --- Core Interview Logic Functions ---

    const addStatus = useCallback((text: string) => {
        setMessages(prev => [...prev, { sender: "interviewer", text, type: "status" }]);
    }, []);

    /**
     * Handles the AI's response: updates the chat, plays audio, and updates state.
     */
    const handleAiResponse = useCallback((data: InterviewResponse) => {
        // 1. Add AI message to chat history
        setMessages(prev => [...prev, {
            sender: "interviewer",
            text: data.response,
            type: "question"
        }]);

        // 2. Update session state
        setSessionId(data.session_id);
        setInterviewState(data.state);

        // 3. Play the interviewer's voice. audio_url is a data: URL that carries the audio itself.
        if (data.audio_url) {
            // Stop any currently playing audio
            if (audioRef.current) {
                audioRef.current.pause();
            }
            const audio = new Audio(data.audio_url);
            audioRef.current = audio;
            audio.onended = () => { audioRef.current = null; };
            audio.play().catch(e => console.warn("Interviewer audio did not play:", e));
        }
    }, []);

    // --- NEW Audio Recording and Transcription Logic ---

    const startRecording = () => {
        if (!streamRef.current || isProcessing) return;

        try {
            const audioTracks = streamRef.current.getAudioTracks();
            if (audioTracks.length === 0 || !audioTracks[0].enabled) {
                addStatus("Microphone is muted or unavailable. Please enable it before recording.");
                return;
            }

            setInput("");

            let mimeType = "audio/webm";
            if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "";

            const recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType });
            const chunks: Blob[] = [];

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunks.push(event.data);
            };

            recorder.onstart = () => setIsRecording(true);
            recorder.onstop = () => {
                setIsRecording(false);
                recorderRef.current = null;
                if (chunks.length > 0) transcribeAudio(new Blob(chunks, { type: chunks[0].type }));
            };

            recorder.onerror = () => {
                setIsRecording(false);
                addStatus("Recording error occurred. Please try typing your answer.");
            };

            recorder.start();
            recorderRef.current = recorder;
            addStatus("Recording started. Click the mic icon again to stop and transcribe.");

        } catch (error) {
            console.error("Failed to start recording:", error);
            addStatus("Could not start recording. Check browser permissions.");
        }
    };

    // Stops the recorder, which then transcribes what it captured.
    const stopRecording = () => recorderRef.current?.stop();

    // Runs beside the interview, in a background worker: a failure here must never interrupt it.
    const analyzeEmotion = async (audioBlob: Blob) => {
        try {
            emotionsRef.current.push(await analyzeVoice(audioBlob));
        } catch (err) {
            console.error("Voice analysis failed:", err);
        }
    };


    const transcribeAudio = async (audioBlob: Blob) => {
        setIsProcessing(true);
        setIsTranscribing(true);
        pendingEmotionsRef.current.push(analyzeEmotion(audioBlob));

        const formData = new FormData();
        formData.append("audio", audioBlob, "user_answer.webm");

        try {
            const response = await fetch(`${API_BASE_URL}/transcribe_audio`, {
                method: "POST",
                headers: await serviceAuthHeaders(),
                body: formData,
            });

            const data = await response.json();

            if (response.ok && data.transcribed_text) {
                setInput(data.transcribed_text);
                addStatus("Transcription received. Review your answer and click 'Send'.");
            } else {
                console.error("Transcription API error:", data.error);
                addStatus(`Transcription failed: ${data.error || "Unknown error"}. Please type your answer.`);
            }
        } catch (error) {
            console.error("Transcription network error:", error);
            addStatus("Network error during transcription. Please try typing your answer.");
        } finally {
            setIsProcessing(false);
            setIsTranscribing(false);
        }
    };

    // --- Core Interview Logic Functions ---

    /**
     * Starts a new interview session.
     */
    const startInterview = async () => {
        if (isProcessing) return;
        if (!state) {
            toast.error("Choose a role and a resume first.");
            navigate("/dashboard?tab=Simulations");
            return;
        }

        setIsProcessing(true);
        setMessages([]);
        setFeedback(null);
        setLiveTime(0);
        emotionsRef.current = [];
        pendingEmotionsRef.current = [];
        prepareVoiceAnalysis();
        try {
            const response = await fetch(`${API_BASE_URL}/start_interview`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await serviceAuthHeaders()) },
                body: JSON.stringify({
                    company: state.company,
                    role: state.role,
                    resume: state.resume,
                    jd: state.jobDescription,
                    interview_level: state.level,
                    interview_duration: state.duration,
                    interview_type: state.interviewType,
                }),

            });

            const data = await response.json();

            if (response.ok) {
                setSessionId(data.session_id);
                setInterviewState("waiting_intro");
                setMessages([{
                    sender: "interviewer",
                    text: "Welcome! Please click the microphone button to record your self-introduction (or type it in the box) and click 'Send' to begin the interview.",
                    type: "status"
                }]);
            } else {
                addStatus(`The interview could not start: ${data.error}`);
            }
        } catch (error) {
            console.error("Start interview error:", error);
            addStatus("The interview could not start because the interview service did not answer.");
        } finally {
            setIsProcessing(false);
        }
    };


    // The service did not record this message, so take it out of the chat and
    // put it back in the box. Otherwise a retry would save the answer twice.
    const returnUnsent = (text: string, reason: string) => {
        setMessages(prev => {
            const last = prev.map(m => m.sender).lastIndexOf("user");
            return [...prev.filter((_, i) => i !== last), { sender: "interviewer", text: reason, type: "status" }];
        });
        setInput(text);
    };

    /**
     * Main function to handle user input (Intro or Answer)
     */
    const handleSubmitInput = async () => {
        // Input check now uses the editable 'input' state
        if (!input.trim() || isProcessing || !sessionId || isRecording) return;

        const userMessage = input.trim();
        setIsProcessing(true);

        // 1. Add user message to local chat history
        const messageType = interviewState === "waiting_intro" ? "intro" : "answer";
        setMessages(prev => [...prev, { sender: "user", text: userMessage, type: messageType }]);
        setInput(""); // Clear input after queuing for submission

        try {
            const endpoint = interviewState === "waiting_intro"
                ? `${API_BASE_URL}/submit_intro`
                : `${API_BASE_URL}/submit_answer`;

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(await serviceAuthHeaders()) },
                body: JSON.stringify({ session_id: sessionId, text: userMessage })
            });
            const data: InterviewResponse = await response.json();

            if (response.ok) {
                handleAiResponse(data);
            } else {
                console.error("API error:", data.error);
                returnUnsent(userMessage, `Error processing response: ${data.error}`);
            }
        } catch (error) {
            console.error("Submission error:", error);
            returnUnsent(userMessage, "Network error. Please try again.");
        } finally {
            setIsProcessing(false);
        }
    };

    const saveInterview = async (fb: Feedback) => {
        try {
            const res = await fetch(`${BACKEND_URL}/interview/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    role:          state?.role        || "",
                    company:       state?.company     || "",
                    interviewType: state?.interviewType || "",
                    level:         state?.level       || "",
                    duration:      state?.duration    || "",
                    jdId:          state?.jdId,
                    resumeId:      state?.resumeId,
                    transcript:    buildTranscript(messages),
                    feedback:      fb,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            invalidate(queryKeys.interviews);
        } catch (err) {
            console.error("Failed to save interview session:", err);
            toast.error("The interview could not be saved to Reviews.");
        }
    };

    const getFeedback = async () => {
        if (!sessionId || interviewState !== "completed" || feedbackInFlightRef.current) return;
        feedbackInFlightRef.current = true;
        setIsProcessing(true);

        try {
            const response = await fetch(`${API_BASE_URL}/get_feedback/${sessionId}`, {
                method: "GET",
                headers: await serviceAuthHeaders(),
            });
            const data = await response.json();

            if (response.ok) {
                // Give late voice results a moment, but never hold the feedback for a slow analysis.
                await Promise.race([
                    Promise.allSettled(pendingEmotionsRef.current),
                    new Promise(resolve => setTimeout(resolve, EMOTION_WAIT_MS)),
                ]);
                const fb: Feedback = { ...data.feedback, emotion_analysis: summarizeEmotions(emotionsRef.current) };
                setFeedback(fb);
                addStatus("Your feedback is ready. Click the View Feedback button below.");
                await saveInterview(fb);
            } else {
                addStatus(`Failed to fetch feedback: ${data.error}`);
            }
        } catch (error) {
            console.error("Feedback error:", error);
            addStatus("Network error fetching feedback.");
        } finally {
            feedbackInFlightRef.current = false;
            setIsProcessing(false);
        }
    };

    // Fetch the feedback once the closing message has been shown. The button stays as a retry.
    const getFeedbackRef = useRef(getFeedback);
    useEffect(() => { getFeedbackRef.current = getFeedback; });
    useEffect(() => {
        if (interviewState !== "completed") return;
        const timer = setTimeout(() => getFeedbackRef.current(), 2000);
        return () => clearTimeout(timer);
    }, [interviewState]);

    // --- Media Control Handlers ---

    const handleEnable = async () => {
        // Re-run initial media setup to attempt permission grant again
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            streamRef.current = s;
            if (videoRef.current) {
                videoRef.current.srcObject = s;
                videoRef.current.play().catch(e => console.warn("Camera preview did not play:", e));
            }
            setHasMedia(true);
            setPermissionError(null);
        } catch (err) {
            setPermissionError(errorMessage(err, "Permission denied"));
        }
    };

    const toggleVideo = () => {
        if (!streamRef.current) return;
        const tracks = streamRef.current.getVideoTracks();
        if (tracks.length > 0) {
            tracks.forEach(t => (t.enabled = !t.enabled));
            setVideoEnabled(prev => !prev);
        }
    };

    const endCall = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        setHasMedia(false);
        navigate("/dashboard");
    };

    // --- JSX Rendering ---
    const isStartable = interviewState === "initial" && !sessionId && !isProcessing;
    const isReadyForInput = (interviewState === "waiting_intro" || interviewState === "in_interview") && sessionId;

    return (
        <div className="w-screen h-screen bg-white text-black flex overflow-hidden font-sans">
            <div className="flex-1 flex flex-col">
                {/* --- VIDEO AREA - CANDIDATE'S FEED --- */}
                <div className="flex-1 p-4 relative bg-black flex items-center justify-center overflow-hidden">

                    {/* Candidate's video feed */}
                    <div className={`absolute inset-0 bg-black overflow-hidden z-20 ${!hasMedia && 'hidden'}`}>
                        <video
                            ref={videoRef}
                            className={`w-full h-full object-cover transform scale-x-[-1] ${!videoEnabled && 'opacity-30'}`}
                            playsInline
                            muted
                        />


                        {/* Video Disabled Overlay */}
                        {!videoEnabled && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                                <VideoOff className="text-white" size={64} />
                            </div>
                        )}

                        {/* 'You' label and Audio Status */}
                        <div className="absolute bottom-4 left-4 text-white text-lg font-bold">You</div>
                        <div className="absolute bottom-4 right-4 p-2 rounded-full bg-black/50">
                            {audioEnabled ? <Mic size={20} className="text-white" /> : <MicOff size={20} className="text-red-500" />}
                        </div>
                    </div>


                    {/* Overlay for Camera Access Required */}
                    {!hasMedia && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/90 z-30">
                            <div className="bg-white text-black rounded-xl shadow-xl p-8 text-center border border-neutral-300">
                                <div className="mb-4 font-bold text-xl">
                                    Camera & Microphone Access Required
                                </div>
                                <p className="mb-4 text-neutral-600">
                                    The interview requires your video and audio input.
                                </p>
                                <div className="flex gap-3 justify-center">
                                    <button
                                        onClick={handleEnable}
                                        className="px-6 py-2 bg-black text-white font-medium rounded-lg hover:bg-gray-800 transition-colors"
                                    >
                                        Enable Media
                                    </button>
                                    <button
                                        onClick={endCall}
                                        className="px-6 py-2 border border-black rounded-lg hover:bg-neutral-100 transition-colors"
                                    >
                                        Exit
                                    </button>
                                </div>
                                {permissionError && (
                                    <div className="text-red-500 mt-4 text-sm font-medium">{permissionError}</div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* LIVE Status */}
                    {sessionId && (
                        <div className="absolute top-4 left-4 bg-black text-white rounded-full px-3 py-1 text-sm z-30 flex items-center gap-2">
                            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                            {interviewState === "completed" ? "ENDED" : `LIVE ${formatTime(liveTime)}`}
                        </div>
                    )}

                </div>

                {/* --- CONTROL BAR --- */}
                <div className="w-full border-t border-neutral-200 bg-white flex justify-center gap-8 py-4 items-center relative">
                    <div className="text-black font-medium text-lg absolute left-4">
                        {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>

                    {/* Media Controls */}
                    <button
                        onClick={toggleVideo}
                        disabled={!hasMedia}
                        className={`p-3 rounded-full transition-colors ${videoEnabled ? 'bg-black text-white hover:bg-gray-800' : 'bg-red-500 text-white hover:bg-red-600'}`}
                    >
                        {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
                    </button>

                    {/* Microphone/Record Button */}
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        disabled={!hasMedia || !audioEnabled || isProcessing || !isReadyForInput}
                        className={`p-4 rounded-full transition-all shadow-lg ring-4 
                            ${!isRecording
                                ? 'bg-red-600 text-white ring-red-300  hover:bg-red-700'
                                : 'bg-black text-white ring-black/10 animate-pulse hover:bg-gray-800'
                            }`}
                    >
                        {isRecording ? <Mic size={24} /> : <MicOff size={24} />}
                    </button>

                    {/* End Call Button */}
                    <button
                        onClick={endCall}
                        className="p-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
                    >
                        <PhoneOff size={20} />
                    </button>

                    {/* Start Interview Button */}
                    {isStartable && (
                        <button
                            onClick={startInterview}
                            className="absolute right-4 px-6 py-2 bg-green-600 text-white font-medium rounded-full hover:bg-green-700 transition-colors"
                            disabled={!hasMedia || isProcessing}
                        >
                            Start AI Interview
                        </button>
                    )}

                    {/* Get Feedback Button */}
                    {interviewState === "completed" && !feedback && (
                        <button
                            onClick={getFeedback}
                            className="absolute right-4 px-6 py-2 bg-gray-600 text-white font-medium rounded-full hover:bg-gray-700 transition-colors flex items-center gap-2"
                            disabled={isProcessing}
                        >
                            {isProcessing ? <Loader2 size={20} className="animate-spin" /> : "Get Feedback"}
                            {!isProcessing && <BookOpenCheck size={20} />}
                        </button>
                    )}

                    {/* View Feedback Button */}
                    {feedback && (
                        <button
                            onClick={() => setShowFeedbackModal(true)}
                            className="absolute right-4 px-6 py-2 bg-indigo-600 text-white font-medium rounded-full hover:bg-indigo-700 transition-colors flex items-center gap-2"
                        >
                            View Feedback
                            <BookOpenCheck size={20} />
                        </button>
                    )}
                </div>
            </div>

            {/* --- CHAT PANEL --- */}
            <div className="w-[400px] border-l border-neutral-300 bg-white p-4">
                <div className="bg-[#F2F2F5] flex flex-col h-full rounded-3xl">
                    <div className="p-4 px-6 border-b border-neutral-200 flex items-center gap-2">
                        <MessageSquare size={20} className="text-neutral-500" />
                        <div className="text-lg font-semibold">Interview Chat</div>
                    </div>

                    {/* Status/Instructions Block */}
                    <div className="flex flex-col px-4 py-2 mx-4 mt-4 rounded-xl text-[.8rem] text-center overflow-hidden bg-[#e2e2e5] text-neutral-700">
                        <span className="font-semibold">Current State:</span> {interviewState.replace('_', ' ').toUpperCase()}
                        <span className="mt-1 text-[.75rem]">
                            {isRecording ? "🎤 Recording voice. Click MicOff to stop." : isTranscribing ? "⏳ Transcribing audio..." : "Text messages are analyzed in real time."}
                        </span>
                    </div>

                    {/* Message Display Area */}
                    <div className="flex-1 min-h-0 overflow-y-auto">
                        {/* min-h-full keeps a short chat at the bottom and lets a long one scroll */}
                        <div className="min-h-full space-y-3 p-6 pr-3 flex flex-col justify-end">
                        {messages.length === 0 && (
                            <div className="text-neutral-400 text-sm text-center italic">
                                Click 'Start AI Interview' to begin.
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div
                                key={i}
                                className={`p-3 rounded-xl max-w-[85%] text-sm shadow-sm ${m.sender === "user"
                                    ? "bg-black text-white self-end ml-auto"
                                    : "bg-white text-black self-start mr-auto border border-neutral-200"
                                    }`}
                            >
                                <span className="font-semibold text-xs opacity-70 block mb-1">
                                    {m.type === "status"
                                        ? "InterviewMate"
                                        : `${m.sender === "user" ? "You" : "Interviewer"} (${m.type.toUpperCase()})`}
                                </span>
                                {m.text}
                            </div>
                        ))}
                        {isProcessing && interviewState !== "completed" && (
                            <div className="self-start mr-auto">
                                <div className="bg-white text-black p-3 rounded-xl text-sm border border-neutral-200">
                                    <Loader2 className="animate-spin inline mr-2 h-4 w-4" />
                                    Interviewer is thinking...
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                        </div>
                    </div>

                    {/* Input Area */}
                    <form onSubmit={(e) => { e.preventDefault(); handleSubmitInput(); }} className="p-4 pt-2">
                        <div className="flex gap-3 items-center">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                className="flex-1 p-3 border border-neutral-300 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                                placeholder={isReadyForInput ? "Type or record your answer" : interviewState === "completed" ? "The interview has ended" : "Click 'Start AI Interview' to begin"}
                                disabled={!isReadyForInput || isProcessing || isRecording}
                            />
                            <button
                                type="submit"
                                className={`p-3 rounded-full w-10 h-10 transition-colors flex items-center justify-center 
                                    ${(input.trim() && isReadyForInput && !isProcessing && !isRecording) ? 'bg-gray-600 hover:bg-gray-700 text-white' : 'bg-neutral-300 text-neutral-500 cursor-not-allowed'}`}
                                disabled={!input.trim() || !isReadyForInput || isProcessing || isRecording}
                            >
                                {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Feedback Modal */}
            {showFeedbackModal && feedback && (
                <FeedbackModal
                    feedback={feedback}
                    onClose={() => setShowFeedbackModal(false)}
                />
            )}
        </div>
    );
}