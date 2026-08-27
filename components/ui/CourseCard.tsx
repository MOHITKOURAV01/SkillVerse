import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bookmark, CheckCircle, Lock, PlayCircle, Star } from 'lucide-react';
import { Course } from '../../types';

export interface CourseCardProps {
    course: Course;
    /** Whether the learner has already passed this course's quiz. */
    isPassed?: boolean;
    /**
     * Locked courses render as a non-navigable card listing what still has to
     * be completed. Callers derive this with `isCourseUnlocked` so every
     * listing agrees on the same rule.
     */
    isLocked?: boolean;
    /** Outstanding prerequisites, from `getIncompletePrerequisites`. */
    incompletePrerequisites?: Course[];
    /** Omit the bookmark control entirely by leaving `onToggleBookmark` unset. */
    isBookmarked?: boolean;
    onToggleBookmark?: (courseId: string) => void;
}

const LEVEL_PILL_CLASSES: Record<string, string> = {
    Beginner: 'bg-emerald-500/10 text-emerald-500',
    Intermediate: 'bg-blue-500/10 text-blue-500',
    Advanced: 'bg-purple-500/10 text-purple-500',
};

/**
 * The course card used by every listing — the catalogue, a category page, and
 * the saved list.
 *
 * These three screens each carried their own copy of this markup, which is how
 * they drifted: only the catalogue honoured prerequisites, so the same course
 * rendered locked on /courses and freely clickable on /category/:id and
 * /saved. Sharing one component makes that class of divergence impossible.
 */
export const CourseCard: React.FC<CourseCardProps> = ({
    course,
    isPassed = false,
    isLocked = false,
    incompletePrerequisites = [],
    isBookmarked = false,
    onToggleBookmark,
}) => {
    const { t } = useTranslation();

    const getDifficultyLabel = (level: string) => {
        switch (level) {
            case 'Beginner':
                return t('common.difficulty.beginner');
            case 'Intermediate':
                return t('common.difficulty.intermediate');
            case 'Advanced':
                return t('common.difficulty.advanced');
            default:
                return level;
        }
    };

    const levelPill = (
        <span
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${LEVEL_PILL_CLASSES[course.level] ?? 'bg-primary/10 text-primaryLight'
                }`}
        >
            {getDifficultyLabel(course.level)}
        </span>
    );

    const metaRow = (
        <div className="pt-4 border-t border-black/20 dark:border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <span className="text-xs text-textMuted font-mono">{course.duration}</span>
                {course.reviewCount ? (
                    <span className="flex items-center gap-1 text-xs font-bold text-amber-500">
                        <Star size={12} className="fill-amber-500" />
                        {course.rating?.toFixed(1)}
                        <span className="text-textMuted font-normal">({course.reviewCount})</span>
                    </span>
                ) : (
                    <span className="text-xs text-textMuted italic">No reviews yet</span>
                )}
            </div>

            {isLocked ? (
                <span className="flex items-center text-sm font-semibold text-textMuted" aria-hidden="true">
                    Locked
                    <Lock size={16} className="ml-2 text-amber-500" />
                </span>
            ) : (
                <span className="flex items-center text-sm font-bold text-textMain group-hover:translate-x-1 transition-transform">
                    {isPassed ? t('courses.review') : t('courses.startLearning')}
                    <PlayCircle size={16} className="ml-2" />
                </span>
            )}
        </div>
    );

    return (
        <div
            className={`group relative bg-glass border rounded-2xl p-6 transition-all duration-300 flex flex-col ${isLocked
                ? 'border-black/10 dark:border-white/10 opacity-80'
                : 'border-black/20 dark:border-white/10 hover:border-black/40 dark:hover:border-white/40 hover:shadow-xl hover:shadow-primary/5'
                }`}
        >
            {/* Bookmarking stays available on locked cards — saving a course you
                cannot start yet is exactly when you most want to save it. */}
            {onToggleBookmark && (
                <button
                    type="button"
                    onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleBookmark(course.id);
                    }}
                    className={`absolute top-4 right-4 z-10 p-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight ${isBookmarked ? 'text-primaryLight' : 'text-textMuted hover:text-primaryLight'
                        } hover:bg-primary/10`}
                    aria-label={isBookmarked ? t('courses.bookmarkRemove') : t('courses.bookmarkAdd')}
                    title={isBookmarked ? t('courses.bookmarkRemove') : t('courses.bookmarkAdd')}
                >
                    <Bookmark size={18} className={isBookmarked ? 'fill-primaryLight text-primaryLight' : ''} />
                </button>
            )}

            {isLocked ? (
                <div
                    className="flex flex-col flex-1"
                    role="region"
                    aria-label={`${course.title} — locked. Complete prerequisites first.`}
                >
                    <div className={`flex justify-between items-start mb-4 ${onToggleBookmark ? 'pr-8' : ''}`}>
                        {levelPill}
                        <Lock size={20} className="text-amber-500" aria-hidden="true" />
                    </div>

                    <h3 className="text-xl font-bold text-textMain mb-2">{course.title}</h3>
                    <p className="text-sm text-textMuted mb-4 flex-1 line-clamp-3">{course.description}</p>

                    {incompletePrerequisites.length > 0 && (
                        <div className="mb-4">
                            <p className="text-xs text-amber-500 font-semibold mb-2 flex items-center gap-1">
                                <Lock size={12} aria-hidden="true" />
                                Complete first:
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {incompletePrerequisites.map(prereq => (
                                    <Link
                                        key={prereq.id}
                                        to={`/course/${prereq.id}`}
                                        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primaryLight text-xs font-semibold hover:bg-primary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                        aria-label={`Go to prerequisite course: ${prereq.title}`}
                                    >
                                        {prereq.title}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {metaRow}
                </div>
            ) : (
                <Link to={`/course/${course.id}`} className="flex flex-col flex-1">
                    <div className={`flex justify-between items-start mb-4 ${onToggleBookmark ? 'pr-8' : ''}`}>
                        {levelPill}
                        {isPassed && <CheckCircle className="text-success" size={20} />}
                    </div>

                    <h3 className="text-xl font-bold text-textMain mb-2 group-hover:text-primaryLight transition-colors">
                        {course.title}
                    </h3>
                    <p className="text-sm text-textMuted mb-6 flex-1 line-clamp-3">{course.description}</p>

                    {metaRow}
                </Link>
            )}
        </div>
    );
};

export default CourseCard;
