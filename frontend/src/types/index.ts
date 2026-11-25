export interface Education {
    institution: string;
    degree: string;
    duration: string;
    score: string;
}

export interface Project {
    title: string;
    duration: string;
    tech: string;
    event: string;
    points: string[];
}

export interface Resume {
    _id?: string;

    userId?: string;
    title: string;
    pdfUrl?: string;
    header: {
        name: string;
        phone: string;
        email: string;
        github: string;
    };
    objective: string;
    education: Education[];
    skills: {
        languages: string[];
        frameworks: string[];
        other: string[];
    };
    projects: Project[];
    activities: string[];
}

export interface User {
    _id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    age?: number;
    gender?: string;
    githubUrl?: string;
    linkedinUrl?: string;
    codeforcesUrl?: string;
    leetcodeUrl?: string;
    skills?: string[];
    interests?: string[];
}

export interface JobDescription {
    _id: string;
    url: string;
    title: string;
    company: string;
    location: string;
    description?: string;
    requiredSkills: string[];
    jobType: string;
    createdAt: string;
}

// One answer, as returned by the emotion service.
export interface EmotionPrediction {
    emotion: string;
    confidence: number;
    predictions: Record<string, number>;
}

export interface EmotionResult {
    emotions_3?: EmotionPrediction;
    emotions_6?: EmotionPrediction;
    speaking_style?: { label: string; score: number };
}

// All recorded answers of an interview, averaged.
export interface EmotionSummary {
    answers: number;
    speaking_style?: { label: string; score: number };
    emotions_3?: { emotion: string; confidence: number };
    emotions_6?: { emotion: string; confidence: number };
}
