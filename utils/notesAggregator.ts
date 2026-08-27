/**
 * Aggregation layer for the Notes hub.
 *
 * SkillVerse writes learner notes into two unrelated LocalStorage buckets:
 *
 *  - `skillverse_lesson_notes` — notes typed under a lesson in `LessonNotes`,
 *    keyed by `courseId` + `lessonId` and carrying `createdAt` / `updatedAt`.
 *  - `skillverse_ai_notes` — AI tutor answers bookmarked in `AIAssistant`,
 *    which store a `courseTitle` string and a single `savedAt` timestamp.
 *
 * The two shapes have nothing in common beyond "some text the learner kept",
 * so anything that wants to show both has to normalise them first. This module
 * is that normalisation: it turns both buckets into one `UnifiedNote` list,
 * resolves ids to human-readable course and lesson titles, and provides the
 * search / filter / sort primitives the page needs.
 *
 * Everything here is pure apart from `loadUnifiedNotes`, which reads through
 * `storageService`. Keeping the logic out of the component means the matching
 * rules can be reasoned about (and reused) without rendering anything.
 */

import { Course, LessonNote, SavedAINote } from '../types';
import { storageService } from '../services/storageService';

export type NoteSource = 'lesson' | 'ai';

export interface UnifiedNote {
  /** Stable id, unique across both sources (the underlying note's own id). */
  id: string;
  source: NoteSource;
  /** The note body as the learner wrote or saved it. */
  text: string;
  /** Course this note belongs to, resolved to a title where possible. */
  courseTitle: string;
  /** Course id — only known for lesson notes; AI notes only store a title. */
  courseId?: string;
  /** Lesson id, for lesson notes only. */
  lessonId?: string;
  /** Lesson title resolved from the course curriculum, when it can be found. */
  lessonTitle?: string;
  /** ISO timestamp used for ordering: `updatedAt` for lesson notes, `savedAt` for AI notes. */
  timestamp: string;
  /** True when a lesson note has been edited since it was first written. */
  edited: boolean;
  /** Route that takes the learner back to where the note was made, if reachable. */
  link?: string;
}

export type NoteTypeFilter = 'all' | NoteSource;
export type NoteSortOrder = 'newest' | 'oldest' | 'course';

export interface NoteFilters {
  query: string;
  type: NoteTypeFilter;
  /** Course id for lesson notes, or the raw course title for AI notes. `all` disables the filter. */
  course: string;
  sort: NoteSortOrder;
}

export const DEFAULT_NOTE_FILTERS: NoteFilters = {
  query: '',
  type: 'all',
  course: 'all',
  sort: 'newest',
};

export interface NoteCounts {
  total: number;
  lesson: number;
  ai: number;
  courses: number;
}

export interface CourseOption {
  /** Course id when known, otherwise the course title (AI notes have no id). */
  value: string;
  label: string;
}

/**
 * Looks up a lesson title inside a course's chapter tree.
 *
 * Lesson notes are currently all written against the synthetic `main-lesson`
 * id that `CourseView` passes, and Firestore-backed courses may not carry
 * chapters at all, so a miss here is expected rather than exceptional — the
 * caller falls back to the course title.
 */
const findLessonTitle = (course: Course | undefined, lessonId: string): string | undefined => {
  if (!course?.chapters) return undefined;
  for (const chapter of course.chapters) {
    const lesson = chapter.lessons?.find(l => l.id === lessonId);
    if (lesson) return lesson.title;
  }
  return undefined;
};

/** Parses an ISO timestamp into a sortable number, treating junk as "oldest". */
const toTime = (iso: string): number => {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Normalises one lesson note. `courses` is whatever list the caller already
 * has (Firestore courses, or the bundled `COURSES`), so the aggregator never
 * issues a fetch of its own.
 */
const fromLessonNote = (note: LessonNote, courses: Course[]): UnifiedNote => {
  const course = courses.find(c => c.id === note.courseId);
  const lessonTitle = findLessonTitle(course, note.lessonId);

  return {
    id: note.id,
    source: 'lesson',
    text: note.text ?? '',
    courseId: note.courseId,
    courseTitle: course?.title ?? note.courseId,
    lessonId: note.lessonId,
    lessonTitle,
    timestamp: note.updatedAt || note.createdAt,
    edited: Boolean(note.updatedAt && note.createdAt && note.updatedAt !== note.createdAt),
    // Only link to a course we can actually resolve; a dangling id would send
    // the learner to the NotFound screen.
    link: course ? `/course/${course.id}` : undefined,
  };
};

/**
 * Normalises one saved AI note. These only record a course *title*, so the id
 * is recovered by matching that title back against the course list — best
 * effort, and simply absent when the course has since been renamed or removed.
 */
const fromAINote = (note: SavedAINote, courses: Course[]): UnifiedNote => {
  const course = courses.find(c => c.title === note.courseTitle);

  return {
    id: note.id,
    source: 'ai',
    text: note.text ?? '',
    courseId: course?.id,
    courseTitle: note.courseTitle || 'General',
    timestamp: note.savedAt,
    edited: false,
    link: course ? `/course/${course.id}` : undefined,
  };
};

/**
 * Reads both buckets and returns one list, newest first.
 *
 * Ids are de-duplicated defensively: the two buckets use different prefixes
 * (`note_…` vs a timestamp-index pair), but a restored backup could in
 * principle reintroduce a collision, and React keys have to stay unique.
 */
export const loadUnifiedNotes = (courses: Course[]): UnifiedNote[] => {
  const lessonNotes = storageService.getAllLessonNotes().map(note => fromLessonNote(note, courses));
  const aiNotes = storageService.getSavedAINotes().map(note => fromAINote(note, courses));

  const seen = new Set<string>();
  const combined: UnifiedNote[] = [];

  [...lessonNotes, ...aiNotes].forEach(note => {
    const key = `${note.source}:${note.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    combined.push(note);
  });

  return combined.sort((a, b) => toTime(b.timestamp) - toTime(a.timestamp));
};

/** Counts for the summary tiles, computed over the *unfiltered* list. */
export const countNotes = (notes: UnifiedNote[]): NoteCounts => ({
  total: notes.length,
  lesson: notes.filter(n => n.source === 'lesson').length,
  ai: notes.filter(n => n.source === 'ai').length,
  courses: new Set(notes.map(n => n.courseId ?? n.courseTitle)).size,
});

/**
 * Builds the course dropdown options, ordered by title so the list is stable
 * regardless of when each note happened to be written.
 */
export const buildCourseOptions = (notes: UnifiedNote[]): CourseOption[] => {
  const byValue = new Map<string, string>();

  notes.forEach(note => {
    const value = note.courseId ?? note.courseTitle;
    if (!byValue.has(value)) byValue.set(value, note.courseTitle);
  });

  return Array.from(byValue.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * Case-insensitive substring match across every field a learner would
 * plausibly search by. Deliberately not fuzzy — notes are the learner's own
 * words, so an exact substring is what they expect to find.
 */
export const matchesQuery = (note: UnifiedNote, rawQuery: string): boolean => {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  return (
    note.text.toLowerCase().includes(q) ||
    note.courseTitle.toLowerCase().includes(q) ||
    (note.lessonTitle ?? '').toLowerCase().includes(q)
  );
};

/** Applies the type, course and query filters, then orders the result. */
export const filterNotes = (notes: UnifiedNote[], filters: NoteFilters): UnifiedNote[] => {
  const filtered = notes.filter(note => {
    if (filters.type !== 'all' && note.source !== filters.type) return false;
    if (filters.course !== 'all' && (note.courseId ?? note.courseTitle) !== filters.course) return false;
    return matchesQuery(note, filters.query);
  });

  return sortNotes(filtered, filters.sort);
};

/** Ordering, extracted so the sort rules can be unit-reasoned in isolation. */
export const sortNotes = (notes: UnifiedNote[], order: NoteSortOrder): UnifiedNote[] => {
  const sorted = [...notes];

  switch (order) {
    case 'oldest':
      return sorted.sort((a, b) => toTime(a.timestamp) - toTime(b.timestamp));
    case 'course':
      // Group by course, then keep each group newest-first so the most recent
      // thinking about a topic sits at the top of its group.
      return sorted.sort(
        (a, b) =>
          a.courseTitle.localeCompare(b.courseTitle) || toTime(b.timestamp) - toTime(a.timestamp)
      );
    case 'newest':
    default:
      return sorted.sort((a, b) => toTime(b.timestamp) - toTime(a.timestamp));
  }
};

/** True when any filter is narrowing the list — drives the "Clear filters" affordance. */
export const hasActiveFilters = (filters: NoteFilters): boolean =>
  filters.query.trim() !== '' ||
  filters.type !== 'all' ||
  filters.course !== 'all' ||
  filters.sort !== DEFAULT_NOTE_FILTERS.sort;

/**
 * Absolute date + time for a note, in the viewer's locale.
 * Invalid timestamps render as an em dash rather than "Invalid Date".
 */
export const formatNoteTimestamp = (iso: string): string => {
  const time = toTime(iso);
  if (time === 0) return '—';

  return new Date(time).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Short relative label ("3d ago") used on the compact card footer. */
export const formatRelativeTimestamp = (iso: string): string => {
  const time = toTime(iso);
  if (time === 0) return '—';

  const diffMin = Math.floor((Date.now() - time) / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;

  return new Date(time).toLocaleDateString();
};
