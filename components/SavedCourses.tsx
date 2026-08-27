import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bookmark, BookOpen } from 'lucide-react';
import { COURSES } from '../constants';
import { storageService } from '../services/storageService';
import { firestoreService } from '../services/firestoreService';
import { courseBookmarks } from '../utils/courseBookmarks';
import { useBookmarks } from '../hooks/useBookmarks';
import { isCourseUnlocked, getIncompletePrerequisites } from '../utils/prerequisites';
import { Course } from '../types';
import { CourseCard } from './ui/CourseCard';

export const SavedCourses: React.FC = () => {
    const { t } = useTranslation();
    const [courses, setCourses] = useState<Course[]>(COURSES);
    const [isLoading, setIsLoading] = useState(true);
    const bookmarkedIds = useBookmarks();

    useEffect(() => {
        const loadCourses = async () => {
            try {
                const data = await firestoreService.getCourses();
                if (data && data.length > 0) {
                    setCourses(data);
                } else {
                    setCourses(COURSES);
                }
            } catch (error) {
                console.error('Error fetching courses from Firestore:', error);
                setCourses(COURSES);
            } finally {
                setIsLoading(false);
            }
        };
        loadCourses();
    }, []);

    const progress = useMemo(() => storageService.getAllProgress(), []);

    const bookmarkedCourses = useMemo(
        () => courses.filter(course => bookmarkedIds.includes(course.id)),
        [courses, bookmarkedIds]
    );

    return (
        <div className="animate-fade-in space-y-8">
            <div>
                <h1 className="text-3xl font-display font-bold text-textMain mb-2">{t('savedCourses.title')}</h1>
                <p className="text-textMuted">{t('savedCourses.subtitle')}</p>
            </div>

            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div
                            key={index}
                            className="bg-glass border border-black/20 dark:border-white/10 rounded-2xl p-6 animate-pulse h-52"
                        />
                    ))}
                </div>
            ) : bookmarkedCourses.length === 0 ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                        <Bookmark className="text-primaryLight" size={28} />
                    </div>
                    <h3 className="text-xl font-bold text-textMain mb-2">{t('savedCourses.emptyTitle')}</h3>
                    <p className="text-textMuted mb-6 max-w-md mx-auto">{t('savedCourses.emptyBody')}</p>
                    <Link
                        to="/courses"
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-main text-white font-bold shadow hover:scale-105 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                        <BookOpen size={16} />
                        {t('savedCourses.emptyCta')}
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {bookmarkedCourses.map(course => {
                        const isLocked = !isCourseUnlocked(course, progress);

                        return (
                            <CourseCard
                                key={course.id}
                                course={course}
                                isPassed={progress.find(p => p.courseId === course.id)?.passed}
                                isLocked={isLocked}
                                incompletePrerequisites={
                                    isLocked ? getIncompletePrerequisites(course, courses, progress) : []
                                }
                                isBookmarked
                                onToggleBookmark={courseBookmarks.toggleBookmark}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
};
