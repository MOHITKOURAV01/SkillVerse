import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  NotebookPen,
  Search,
  Sparkles,
  BookOpen,
  Trash2,
  Pencil,
  X,
  Check,
  Download,
  Loader2,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { COURSES } from '../constants';
import { storageService } from '../services/storageService';
import { firestoreService } from '../services/firestoreService';
import { generateLessonNotesPDF } from '../utils/pdfGenerator';
import { useToast } from '../contexts/ToastContext';
import { Course, LessonNote, SavedAINote } from '../types';

/**
 * "My Notes" — one searchable view over every note the learner has written.
 *
 * Lesson notes are scoped to a (courseId, lessonId) pair and only render
 * inside the lesson that created them; AI Assistant notes are only reachable
 * from the assistant panel. Neither is findable after the fact, which is
 * exactly the point at which people stop taking notes. `storageService`
 * already exposes `getAllLessonNotes()` and `getSavedAINotes()` — nothing here
 * needs a new persistence layer, only a place to read them together.
 */

type NoteSource = 'lesson' | 'ai';
type SourceFilter = 'all' | NoteSource;

interface UnifiedNote {
  id: string;
  source: NoteSource;
  text: string;
  /** Stable key used by the course dropdown. */
  courseKey: string;
  courseLabel: string;
  /** Present only when the note can be traced back to a real course route. */
  courseId?: string;
  lessonLabel?: string;
  /** ISO timestamp used for sorting and display. */
  timestamp: string;
  edited: boolean;
}

const ALL_COURSES_KEY = 'all';

/**
 * Course notes are all written against the single synthetic `main-lesson`
 * id today, so a per-lesson label would just repeat the course title. Real
 * chapter lessons are still resolved when a note carries one, so this keeps
 * working if lesson-level routing lands later.
 */
const MAIN_LESSON_ID = 'main-lesson';

const resolveLessonTitle = (course: Course | undefined, lessonId: string): string | undefined => {
  if (!course || lessonId === MAIN_LESSON_ID) return undefined;
  for (const chapter of course.chapters || []) {
    const lesson = chapter.lessons.find(l => l.id === lessonId);
    if (lesson) return lesson.title;
  }
  return undefined;
};

export const NotesHub: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [courses, setCourses] = useState<Course[]>(COURSES);
  const [lessonNotes, setLessonNotes] = useState<LessonNote[]>([]);
  const [aiNotes, setAiNotes] = useState<SavedAINote[]>([]);

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [courseFilter, setCourseFilter] = useState<string>(ALL_COURSES_KEY);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const loadNotes = useCallback(() => {
    setLessonNotes(storageService.getAllLessonNotes());
    setAiNotes(storageService.getSavedAINotes());
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Titles come from the catalog; a note only stores the course id. Falls back
  // to the bundled constant so the page is usable offline and while loading.
  useEffect(() => {
    let cancelled = false;
    firestoreService
      .getCourses()
      .then(data => {
        if (!cancelled && data && data.length > 0) setCourses(data);
      })
      .catch(error => {
        console.error('Notes: could not load the course catalog:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const coursesById = useMemo(() => {
    const map = new Map<string, Course>();
    courses.forEach(course => map.set(course.id, course));
    return map;
  }, [courses]);

  const coursesByTitle = useMemo(() => {
    const map = new Map<string, Course>();
    courses.forEach(course => map.set(course.title.toLowerCase(), course));
    return map;
  }, [courses]);

  /**
   * Both note kinds flattened into one shape, newest first. AI notes only
   * store a `courseTitle`, so they are matched back to a real course by title
   * where possible — that is what lets a single course filter cover both.
   */
  const allNotes: UnifiedNote[] = useMemo(() => {
    const fromLessons: UnifiedNote[] = lessonNotes.map(note => {
      const course = coursesById.get(note.courseId);
      return {
        id: note.id,
        source: 'lesson',
        text: note.text,
        courseKey: note.courseId,
        courseLabel: course?.title || note.courseId,
        courseId: note.courseId,
        lessonLabel: resolveLessonTitle(course, note.lessonId),
        timestamp: note.updatedAt || note.createdAt,
        edited: Boolean(note.updatedAt && note.createdAt && note.updatedAt !== note.createdAt),
      };
    });

    const fromAi: UnifiedNote[] = aiNotes.map(note => {
      const matched = coursesByTitle.get((note.courseTitle || '').toLowerCase());
      return {
        id: note.id,
        source: 'ai',
        text: note.text,
        courseKey: matched ? matched.id : `title:${note.courseTitle || 'unknown'}`,
        courseLabel: note.courseTitle || t('notes.unknownCourse'),
        courseId: matched?.id,
        timestamp: note.savedAt,
        edited: false,
      };
    });

    return [...fromLessons, ...fromAi].sort(
      (a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)
    );
  }, [lessonNotes, aiNotes, coursesById, coursesByTitle, t]);

  /** Course dropdown options, with a count so empty selections are obvious. */
  const courseOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    allNotes.forEach(note => {
      const existing = counts.get(note.courseKey);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(note.courseKey, { label: note.courseLabel, count: 1 });
      }
    });
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allNotes]);

  // A course whose notes were all just deleted would otherwise leave the
  // dropdown pointing at a value that no longer exists, showing nothing.
  useEffect(() => {
    if (courseFilter === ALL_COURSES_KEY) return;
    if (!courseOptions.some(option => option.key === courseFilter)) {
      setCourseFilter(ALL_COURSES_KEY);
    }
  }, [courseOptions, courseFilter]);

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return allNotes.filter(note => {
      if (sourceFilter !== 'all' && note.source !== sourceFilter) return false;
      if (courseFilter !== ALL_COURSES_KEY && note.courseKey !== courseFilter) return false;
      if (!query) return true;

      return (
        note.text.toLowerCase().includes(query) ||
        note.courseLabel.toLowerCase().includes(query) ||
        (note.lessonLabel || '').toLowerCase().includes(query)
      );
    });
  }, [allNotes, search, sourceFilter, courseFilter]);

  const hasActiveFilters =
    search.trim() !== '' || sourceFilter !== 'all' || courseFilter !== ALL_COURSES_KEY;

  const clearFilters = () => {
    setSearch('');
    setSourceFilter('all');
    setCourseFilter(ALL_COURSES_KEY);
  };

  const startEditing = (note: UnifiedNote) => {
    setEditingId(note.id);
    setEditingText(note.text);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingText('');
  };

  const handleUpdateNote = (id: string) => {
    const text = editingText.trim();
    if (!text) return;
    storageService.updateLessonNote(id, text);
    cancelEditing();
    loadNotes();
  };

  const handleDeleteNote = (note: UnifiedNote) => {
    if (note.source === 'lesson') {
      storageService.deleteLessonNote(note.id);
    } else {
      storageService.deleteAINote(note.id);
    }
    if (editingId === note.id) cancelEditing();
    loadNotes();
    showToast({ message: t('notes.deleted'), type: 'success' });
  };

  /**
   * Exports whatever is currently on screen, not everything — a learner who
   * has narrowed to one course expects that course's notes in the file.
   */
  const handleExport = async () => {
    if (filteredNotes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const scopeLabel =
        courseFilter === ALL_COURSES_KEY
          ? t('notes.exportAllCourses')
          : courseOptions.find(option => option.key === courseFilter)?.label || '';

      await generateLessonNotesPDF({
        courseName: t('notes.title'),
        lessonTitle: scopeLabel,
        date: new Date().toLocaleDateString(),
        notes: filteredNotes.map(note => ({
          // The PDF has no column for the source, so the origin is prefixed
          // into the body — otherwise the export loses which course a note
          // came from, which is the whole reason for aggregating them.
          text: `[${note.courseLabel}] ${note.text}`,
          updatedAt: note.timestamp,
        })),
      });
      showToast({ message: t('notes.exportSuccess'), type: 'success' });
    } catch (err) {
      console.error('Notes export failed:', err);
      showToast({ message: t('notes.exportError'), type: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const formatDate = (iso: string) => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const lessonNoteCount = allNotes.filter(n => n.source === 'lesson').length;
  const aiNoteCount = allNotes.filter(n => n.source === 'ai').length;

  const SOURCE_TABS: { value: SourceFilter; label: string; count: number }[] = [
    { value: 'all', label: t('notes.filterAll'), count: allNotes.length },
    { value: 'lesson', label: t('notes.filterLesson'), count: lessonNoteCount },
    { value: 'ai', label: t('notes.filterAI'), count: aiNoteCount },
  ];

  return (
    <div className="animate-fade-in space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-textMain mb-2 flex items-center gap-3">
            <NotebookPen className="text-primaryLight" size={28} />
            {t('notes.title')}
          </h1>
          <p className="text-textMuted">{t('notes.subtitle')}</p>
        </div>

        {filteredNotes.length > 0 && (
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-main text-white font-bold text-sm shadow hover:shadow-lg hover:shadow-primary/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {isExporting ? t('notes.exporting') : t('notes.export')}
          </button>
        )}
      </div>

      {allNotes.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <NotebookPen className="text-primaryLight" size={28} />
          </div>
          <h3 className="text-xl font-bold text-textMain mb-2">{t('notes.emptyTitle')}</h3>
          <p className="text-textMuted mb-6 max-w-md mx-auto">{t('notes.emptyBody')}</p>
          <Link
            to="/courses"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-main text-white font-bold shadow hover:scale-105 transition-all"
          >
            <BookOpen size={16} />
            {t('notes.emptyCta')}
          </Link>
        </div>
      ) : (
        <>
          {/* Controls */}
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="relative flex-1 group">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-textMuted group-focus-within:text-primaryLight transition-colors"
                size={18}
                aria-hidden="true"
              />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('notes.searchPlaceholder')}
                aria-label={t('notes.searchPlaceholder')}
                className="w-full bg-gradient-input border border-primary/20 rounded-xl py-3 pl-11 pr-4 text-black placeholder-textMuted focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight transition-all"
              />
            </div>

            <div className="relative group min-w-[220px]">
              <select
                value={courseFilter}
                onChange={e => setCourseFilter(e.target.value)}
                aria-label={t('notes.courseFilterLabel')}
                className="w-full bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl py-3 pl-4 pr-10 text-textMain focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight appearance-none cursor-pointer transition-all"
              >
                <option value={ALL_COURSES_KEY} className="bg-white dark:bg-[#0B1220] text-textMain">
                  {t('notes.allCourses')}
                </option>
                {courseOptions.map(option => (
                  <option key={option.key} value={option.key} className="bg-white dark:bg-[#0B1220] text-textMain">
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
              <ChevronDown
                className="absolute right-4 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none"
                size={16}
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Source tabs */}
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={t('notes.sourceFilterLabel')}>
            {SOURCE_TABS.map(tab => {
              const selected = sourceFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setSourceFilter(tab.value)}
                  className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight ${selected
                    ? 'bg-primary/20 border-primary/40 text-primaryLight'
                    : 'bg-primary/5 dark:bg-primary/10 border-primary/20 text-textMuted hover:text-textMain'
                    }`}
                >
                  {tab.label}
                  <span className="ml-2 text-xs opacity-80">{tab.count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-sm text-textMuted">
            <span aria-live="polite">{t('notes.resultsCount', { count: filteredNotes.length })}</span>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-primaryLight hover:underline font-semibold"
              >
                <X size={14} />
                {t('notes.clearFilters')}
              </button>
            )}
          </div>

          {/* Notes */}
          {filteredNotes.length === 0 ? (
            <div className="text-center py-16 text-textMuted">
              <p className="mb-4">{t('notes.noMatches')}</p>
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primaryLight font-semibold hover:bg-primary/20 transition-colors"
              >
                <X size={16} />
                {t('notes.clearFilters')}
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {filteredNotes.map(note => (
                <li
                  key={`${note.source}-${note.id}`}
                  className="bg-glass border border-black/20 dark:border-white/10 rounded-2xl p-5"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${note.source === 'ai'
                        ? 'bg-purple-500/10 text-purple-400'
                        : 'bg-emerald-500/10 text-emerald-500'
                        }`}
                    >
                      {note.source === 'ai' ? <Sparkles size={11} /> : <NotebookPen size={11} />}
                      {note.source === 'ai' ? t('notes.badgeAI') : t('notes.badgeLesson')}
                    </span>

                    {note.courseId ? (
                      <Link
                        to={`/course/${note.courseId}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primaryLight hover:underline"
                      >
                        {note.courseLabel}
                        <ExternalLink size={11} aria-hidden="true" />
                      </Link>
                    ) : (
                      <span className="text-xs font-semibold text-textMuted">{note.courseLabel}</span>
                    )}

                    {note.lessonLabel && (
                      <span className="text-xs text-textMuted">· {note.lessonLabel}</span>
                    )}

                    <span className="ml-auto text-xs text-textMuted">
                      {formatDate(note.timestamp)}
                      {note.edited && ` ${t('notes.edited')}`}
                    </span>
                  </div>

                  {editingId === note.id ? (
                    <div>
                      <textarea
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        rows={4}
                        autoFocus
                        aria-label={t('notes.editLabel')}
                        className="w-full resize-none rounded-lg border border-black/20 dark:border-white/10 bg-white/70 dark:bg-white/10 p-3 text-sm text-textMain focus:outline-none focus:ring-2 focus:ring-primaryLight"
                      />
                      <div className="flex justify-end gap-2 mt-2">
                        <button
                          onClick={cancelEditing}
                          className="inline-flex items-center gap-1 text-xs font-medium text-textMuted hover:text-textMain px-3 py-1.5 rounded-lg transition-colors"
                        >
                          <X size={14} /> {t('notes.cancel')}
                        </button>
                        <button
                          onClick={() => handleUpdateNote(note.id)}
                          disabled={!editingText.trim()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-primary hover:bg-primary/90 px-3 py-1.5 rounded-lg disabled:opacity-40 transition-colors"
                        >
                          <Check size={14} /> {t('notes.save')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <p className="text-sm text-textMain whitespace-pre-wrap break-words flex-1">
                        {note.text}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        {/* AI notes are a saved transcript of an assistant
                            reply, so editing them would misrepresent what was
                            actually said — they can only be deleted. */}
                        {note.source === 'lesson' && (
                          <button
                            onClick={() => startEditing(note)}
                            aria-label={t('notes.editLabel')}
                            className="p-1.5 rounded-lg text-textMuted hover:text-textMain hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteNote(note)}
                          aria-label={t('notes.deleteLabel')}
                          className="p-1.5 rounded-lg text-textMuted hover:text-danger hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
