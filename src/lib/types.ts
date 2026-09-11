export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";

export type TimetableEntry = {
  id: string;
  day: Weekday;
  subject: string;
  startTime: string;
  endTime: string;
  room?: string;
  type: "class" | "free";
};

export type AttendanceStatus = "present" | "absent" | "cancelled";

export type AttendanceRecord = {
  id: string;
  timetableEntryId: string;
  subject: string;
  date: string;
  startTime: string;
  endTime: string;
  status: AttendanceStatus;
};

export type AssignmentPriority = "low" | "medium" | "high";

export type Assignment = {
  id: string;
  title: string;
  subject: string;
  dueDate: string;
  dueTime: string;
  priority: AssignmentPriority;
  completed: boolean;
};

export type SubjectAttendance = {
  subject: string;
  present: number;
  absent: number;
  cancelled: number;
  conducted: number;
  percentage: number;
  guidance: string;
};

export type StudyMode = "course" | "explore";

export type StudySource = {
  id: string;
  type: "file" | "youtube";
  name: string;
  mimeType?: string;
  geminiFileName?: string;
  geminiUri?: string;
  url?: string;
  createdAt: string;
  status: "ready" | "needs-reupload";
};

export type WebCitation = {
  title: string;
  url: string;
};

export type StudyMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  mode: StudyMode;
  contextSources?: string[];
  webSearchUsed?: boolean;
  citations?: WebCitation[];
};

export type QuizDifficulty = "easy" | "medium" | "hard";

export type QuizQuestion = {
  id: string;
  question: string;
  options: [string, string, string, string];
  correctOptionIndex: number;
  topic: string;
  explanation: string;
};

export type GeneratedQuiz = {
  id: string;
  title: string;
  difficulty: QuizDifficulty;
  questions: QuizQuestion[];
  sourceIds: string[];
  sourceNames: string[];
  createdAt: string;
};

export type TopicPerformance = {
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
  status: "weak" | "developing" | "strong";
};

export type QuizAttempt = {
  id: string;
  quizId: string;
  title: string;
  createdAt: string;
  completedAt: string;
  difficulty: QuizDifficulty;
  sourceIds: string[];
  sourceNames: string[];
  questionCount: number;
  correctAnswers: number;
  incorrectAnswers: number;
  unanswered: number;
  percentage: number;
  durationSeconds: number;
  weakTopics: string[];
  developingTopics: string[];
  strongTopics: string[];
  topicPerformance: TopicPerformance[];
  questions: QuizQuestion[];
  selectedAnswers: Array<number | null>;
  recommendation: string;
  remoteSynced?: boolean;
};

export type ProfileRole = "student" | "teacher";

export type StudentProfile = {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  role: ProfileRole;
  created_at: string;
  updated_at: string;
};

export type OfficialSubject = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  teacher_id: string;
  join_code: string;
  file_search_store_name: string | null;
  created_at: string;
  updated_at: string;
};

export type SubjectSource = {
  id: string;
  subject_id: string;
  uploaded_by: string;
  name: string;
  mime_type: string;
  gemini_file_search_document_name: string | null;
  status: "processing" | "ready" | "failed";
  created_at: string;
};

export type SubjectQuestion = {
  id: string;
  subject_id: string;
  student_id: string;
  question: string;
  status: "pending" | "answered";
  teacher_answer: string | null;
  created_at: string;
  answered_at: string | null;
};

export type SubjectChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  answerableFromOfficialSources?: boolean;
  sources?: string[];
};
