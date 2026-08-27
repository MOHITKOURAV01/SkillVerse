import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Search,
    FileText,
    BookOpen,
    Sparkles,
    Clock,
    RefreshCcw,
    LayoutGrid,
    List,
    Pencil,
    Trash2,
    Check,
    X,
    ArrowUpRight,
    NotebookPen,
    Layers,
} from 'lucide-react';
import { COURSES } from '../constants';
import { Course } from '../types';
import { storageService } from '../services/storageService';
import { firestoreService } from '../services/firestoreService';
import { useToast } from '../contexts/ToastContext';
import {
    UnifiedNote,
    NoteFilters,
    NoteSortOrder,
    NoteTypeFilter,
    DEFAULT_NOTE_FILTERS,
    loadUnifiedNotes,
    filterNotes,
    countNotes,
    buildCourseOptions,
    hasActiveFilters,
    formatNoteTimestamp,
    formatRelativeTimestamp,
} from '../utils/notesAggregator';

type ViewMode = 'grid' | 'list';

const TYPE_TABS: { value: NoteTypeFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'lesson', label: 'Lesson' },
    { value: 'ai', label: 'AI' },
];

const SORT_OPTIONS: { value: NoteSortOrder; label: string }[] = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'course', label: 'Group by course' },
];

/**
 * Summary tile shown above the list. Counts always describe the full note
 * collection, not the filtered view — the filtered count lives on the results
 * row so the two numbers can never be mistaken for each other.
 */
const StatTile: React.FC<{
    icon: React.ElementType;
    accent: string;
    value: number;
    label: string;
}> = ({ icon: Icon, accent, value, label }) => (
    <div className="bg-glass border border-black/20 dark:border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl ${accent}`}>
                <Icon size={22} />
            </div>
            <div>
                <p className="text-2xl font-bold text-textMain leading-none">{value}</p>
                <p className="text-textMuted text-xs mt-1">{label}</p>
            </div>
        </div>
    </div>
);

/**
 * One note. Lesson notes are editable in place (they are the learner's own
 * prose); AI notes are a captured transcript, so they can be removed but not
 * rewritten — editing them would misrepresent what the tutor actually said.
 */
const NoteCard: React.FC<{
    note: UnifiedNote;
    viewMode: ViewMode;
    isEditing: boolean;
    draft: string;
    onDraftChange: (value: string) => void;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onSaveEdit: () => void;
    onDelete: () => void;
}> = ({ note, viewMode, isEditing, draft, onDraftChange, onStartEdit, onCancelEdit, onSaveEdit, onDelete }) => {
    const isAI = note.source === 'ai';
    const Icon = isAI ? Sparkles : FileText;
    const accent = isAI
        ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400'
        : 'bg-primary/10 text-primaryLight';

    return (
        <article className="bg-glass border border-black/20 dark:border-white/10 rounded-2xl p-5 flex flex-col hover:border-primary/30 transition-colors">
            <header className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-xl shrink-0 ${accent}`}>
                        <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                        <p className="font-semibold text-textMain truncate">
                            {note.lessonTitle || note.courseTitle}
                        </p>
                        <p className="text-xs text-textMuted truncate">
                            {note.lessonTitle ? note.courseTitle : isAI ? 'AI tutor' : 'Lesson note'}
                        </p>
                    </div>
                </div>

                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${accent}`}>
                    {isAI ? 'AI' : 'Lesson'}
                </span>
            </header>

            {isEditing ? (
                <div className="mb-4">
                    <label className="sr-only" htmlFor={`note-edit-${note.id}`}>
                        Edit note
                    </label>
                    <textarea
                        id={`note-edit-${note.id}`}
                        value={draft}
                        onChange={e => onDraftChange(e.target.value)}
                        rows={5}
                        autoFocus
                        className="w-full resize-y rounded-xl border border-black/20 dark:border-white/10 bg-white/60 dark:bg-white/5 p-3 text-sm text-textMain focus:outline-none focus:ring-2 focus:ring-primaryLight"
                    />
                    <div className="flex justify-end gap-2 mt-2">
                        <button
                            type="button"
                            onClick={onCancelEdit}
                            className="inline-flex items-center gap-1 text-xs font-medium text-textMuted hover:text-textMain px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                        >
                            <X size={14} /> Cancel
                        </button>
                        <button
                            type="button"
                            onClick={onSaveEdit}
                            disabled={!draft.trim()}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-primary hover:bg-primary/90 px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                        >
                            <Check size={14} /> Save
                        </button>
                    </div>
                </div>
            ) : (
                <p
                    className={`text-sm text-textMain/90 whitespace-pre-wrap break-words mb-4 flex-1 ${viewMode === 'grid' ? 'line-clamp-6' : ''
                        }`}
                >
                    {note.text}
                </p>
            )}

            <footer className="flex items-center justify-between gap-3 pt-3 border-t border-black/10 dark:border-white/5 mt-auto">
                <span
                    className="flex items-center gap-1.5 text-[11px] text-textMuted"
                    title={formatNoteTimestamp(note.timestamp)}
                >
                    <Clock size={12} />
                    {formatRelativeTimestamp(note.timestamp)}
                    {note.edited && <span className="italic">(edited)</span>}
                </span>

                <div className="flex items-center gap-1">
                    {note.link && (
                        <Link
                            to={note.link}
                            aria-label={`Open ${note.courseTitle}`}
                            title={`Open ${note.courseTitle}`}
                            className="p-1.5 rounded-lg text-textMuted hover:text-primaryLight hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                        >
                            <ArrowUpRight size={15} />
                        </Link>
                    )}

                    {note.source === 'lesson' && !isEditing && (
                        <button
                            type="button"
                            onClick={onStartEdit}
                            aria-label="Edit note"
                            title="Edit note"
                            className="p-1.5 rounded-lg text-textMuted hover:text-textMain hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                        >
                            <Pencil size={15} />
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={onDelete}
                        aria-label="Delete note"
                        title="Delete note"
                        className="p-1.5 rounded-lg text-textMuted hover:text-danger hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                    >
                        <Trash2 size={15} />
                    </button>
                </div>
            </footer>
        </article>
    );
};

/**
 * The Notes hub: one place that aggregates every lesson note and every saved
 * AI answer across all courses.
 *
 * Notes live in LocalStorage and are written from two other screens
 * (`LessonNotes` and `AIAssistant`), so this page owns no note state of its
 * own beyond the in-flight edit draft — it re-reads through
 * `utils/notesAggregator` after every mutation rather than trying to keep a
 * parallel copy in sync.
 */
export const NotesPage: React.FC = () => {
    const { showToast } = useToast();

    // Courses are only needed to turn ids into titles. The bundled list is a
    // perfectly good starting point, so the page renders immediately and
    // simply gets better titles once Firestore answers.
    const [courses, setCourses] = useState<Course[]>(COURSES);
    const [notes, setNotes] = useState<UnifiedNote[]>(() => loadUnifiedNotes(COURSES));
    const [filters, setFilters] = useState<NoteFilters>(DEFAULT_NOTE_FILTERS);
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');

    useEffect(() => {
        let cancelled = false;

        const loadCourses = async () => {
            try {
                const data = await firestoreService.getCourses();
                if (!cancelled && data && data.length > 0) setCourses(data);
            } catch (error) {
                // Titles from the bundled catalogue are already on screen —
                // a failed refresh costs nothing the learner can see.
                console.error('Error fetching courses for the notes page:', error);
            }
        };

        loadCourses();
        return () => {
            cancelled = true;
        };
    }, []);

    // Re-resolve titles whenever the course list changes.
    useEffect(() => {
        setNotes(loadUnifiedNotes(courses));
    }, [courses]);

    const refresh = useCallback(() => {
        setNotes(loadUnifiedNotes(courses));
    }, [courses]);

    const counts = useMemo(() => countNotes(notes), [notes]);
    const courseOptions = useMemo(() => buildCourseOptions(notes), [notes]);
    const visibleNotes = useMemo(() => filterNotes(notes, filters), [notes, filters]);
    const filtersActive = hasActiveFilters(filters);

    const updateFilter = <K extends keyof NoteFilters>(key: K, value: NoteFilters[K]) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const clearFilters = () => setFilters(DEFAULT_NOTE_FILTERS);

    const startEditing = (note: UnifiedNote) => {
        setEditingId(note.id);
        setDraft(note.text);
    };

    const cancelEditing = () => {
        setEditingId(null);
        setDraft('');
    };

    const saveEdit = (note: UnifiedNote) => {
        const text = draft.trim();
        if (!text) return;

        storageService.updateLessonNote(note.id, text);
        cancelEditing();
        refresh();
        showToast({ message: 'Note updated.', type: 'success' });
    };

    const deleteNote = (note: UnifiedNote) => {
        if (note.source === 'lesson') {
            storageService.deleteLessonNote(note.id);
        } else {
            storageService.deleteAINote(note.id);
        }

        if (editingId === note.id) cancelEditing();
        refresh();
        showToast({ message: 'Note deleted.', type: 'success' });
    };

    const hasAnyNotes = notes.length > 0;

    return (
        <div className="animate-fade-in space-y-8">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-display font-bold text-textMain mb-2 flex items-center gap-3">
                        <NotebookPen className="text-primaryLight" size={28} />
                        My Notes
                    </h1>
                    <p className="text-textMuted">
                        Every lesson note and saved AI answer across all of your courses, in one place.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={refresh}
                    className="inline-flex items-center gap-2 self-start md:self-auto px-4 py-2.5 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/20 text-textMuted hover:text-textMain text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                >
                    <RefreshCcw size={16} /> Refresh
                </button>
            </header>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile icon={FileText} accent="bg-primary/10 text-primaryLight" value={counts.total} label="Total notes" />
                <StatTile icon={BookOpen} accent="bg-blue-500/10 text-blue-500 dark:text-blue-400" value={counts.lesson} label="Lesson notes" />
                <StatTile icon={Sparkles} accent="bg-emerald-500/10 text-emerald-500 dark:text-emerald-400" value={counts.ai} label="AI notes" />
                <StatTile icon={Layers} accent="bg-amber-500/10 text-amber-500 dark:text-amber-400" value={counts.courses} label="Courses covered" />
            </div>

            {/* Controls */}
            <div className="bg-glass border border-black/20 dark:border-white/10 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col lg:flex-row gap-4">
                    <div className="relative flex-1 group">
                        <Search
                            size={18}
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-textMuted group-focus-within:text-primaryLight transition-colors"
                        />
                        <label className="sr-only" htmlFor="notes-search">
                            Search notes
                        </label>
                        <input
                            id="notes-search"
                            type="search"
                            value={filters.query}
                            onChange={e => updateFilter('query', e.target.value)}
                            placeholder="Search your notes, courses, or lessons..."
                            className="w-full bg-white/50 dark:bg-white/5 border border-black/20 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-textMain placeholder:text-textMuted focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight transition-all"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div
                            className="flex items-center gap-1 p-1 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/20"
                            role="group"
                            aria-label="Filter notes by type"
                        >
                            {TYPE_TABS.map(tab => (
                                <button
                                    key={tab.value}
                                    type="button"
                                    onClick={() => updateFilter('type', tab.value)}
                                    aria-pressed={filters.type === tab.value}
                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight ${filters.type === tab.value
                                        ? 'bg-gradient-main text-white shadow'
                                        : 'text-textMuted hover:text-textMain'
                                        }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <label className="sr-only" htmlFor="notes-course-filter">
                            Filter by course
                        </label>
                        <select
                            id="notes-course-filter"
                            value={filters.course}
                            onChange={e => updateFilter('course', e.target.value)}
                            className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl px-4 py-2.5 text-sm text-textMain focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight cursor-pointer min-w-[170px]"
                        >
                            <option value="all" className="bg-white dark:bg-[#0B1220] text-textMain">
                                All courses
                            </option>
                            {courseOptions.map(option => (
                                <option
                                    key={option.value}
                                    value={option.value}
                                    className="bg-white dark:bg-[#0B1220] text-textMain"
                                >
                                    {option.label}
                                </option>
                            ))}
                        </select>

                        <label className="sr-only" htmlFor="notes-sort">
                            Sort notes
                        </label>
                        <select
                            id="notes-sort"
                            value={filters.sort}
                            onChange={e => updateFilter('sort', e.target.value as NoteSortOrder)}
                            className="bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-xl px-4 py-2.5 text-sm text-textMain focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight cursor-pointer min-w-[160px]"
                        >
                            {SORT_OPTIONS.map(option => (
                                <option
                                    key={option.value}
                                    value={option.value}
                                    className="bg-white dark:bg-[#0B1220] text-textMain"
                                >
                                    {option.label}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={() => setViewMode(prev => (prev === 'grid' ? 'list' : 'grid'))}
                            aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                            title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
                            className="p-2.5 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/20 text-textMuted hover:text-textMain transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                        >
                            {viewMode === 'grid' ? <List size={16} /> : <LayoutGrid size={16} />}
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between text-sm text-textMuted">
                    <span>
                        {visibleNotes.length} of {counts.total} {counts.total === 1 ? 'note' : 'notes'}
                    </span>
                    {filtersActive && (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="flex items-center gap-1 text-primaryLight hover:underline font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight rounded"
                        >
                            <X size={14} /> Clear filters
                        </button>
                    )}
                </div>
            </div>

            {/* Results */}
            {!hasAnyNotes ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                        <NotebookPen className="text-primaryLight" size={28} />
                    </div>
                    <h2 className="text-xl font-bold text-textMain mb-2">No notes yet</h2>
                    <p className="text-textMuted mb-6 max-w-md mx-auto">
                        Notes you write under a lesson, and AI tutor answers you bookmark, will all collect here.
                    </p>
                    <Link
                        to="/courses"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-main text-white font-bold shadow hover:scale-105 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                        <BookOpen size={16} /> Browse courses
                    </Link>
                </div>
            ) : visibleNotes.length === 0 ? (
                <div className="text-center py-16 bg-glass border border-black/20 dark:border-white/10 rounded-2xl">
                    <p className="text-textMain font-semibold mb-1">No notes match these filters</p>
                    <p className="text-textMuted text-sm mb-5">Try a different search term, or clear the filters.</p>
                    <button
                        type="button"
                        onClick={clearFilters}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 border border-primary/20 text-primaryLight text-sm font-semibold hover:bg-primary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
                    >
                        <X size={14} /> Clear filters
                    </button>
                </div>
            ) : (
                <div
                    className={`grid gap-5 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'
                        }`}
                >
                    {visibleNotes.map(note => (
                        <NoteCard
                            key={`${note.source}-${note.id}`}
                            note={note}
                            viewMode={viewMode}
                            isEditing={editingId === note.id}
                            draft={draft}
                            onDraftChange={setDraft}
                            onStartEdit={() => startEditing(note)}
                            onCancelEdit={cancelEditing}
                            onSaveEdit={() => saveEdit(note)}
                            onDelete={() => deleteNote(note)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default NotesPage;
