import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Loader2 } from 'lucide-react';
import { CATEGORIES, COURSES } from '../constants';
import { storageService } from '../services/storageService';
import { firestoreService } from '../services/firestoreService';
import { courseBookmarks } from '../utils/courseBookmarks';
import { useBookmarks } from '../hooks/useBookmarks';
import { isCourseUnlocked, getIncompletePrerequisites } from '../utils/prerequisites';
import { Course } from '../types';
import { CourseCard } from './ui/CourseCard';
import { CourseLoadError } from './CourseLoadError';
import NotFound from './NotFound';

export const CategoryView: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const category = CATEGORIES.find(c => c.id === id);

  // The bundled catalogue is the floor, not an error path: every other listing
  // falls back to it, and without that this page rendered an empty grid
  // whenever Firestore was unseeded, offline, or refused the read.
  const [courses, setCourses] = useState<Course[]>(COURSES);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const bookmarkedIds = useBookmarks();

  const loadCategoryCourses = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);

    try {
      const all = await firestoreService.getCourses();
      setCourses(all && all.length > 0 ? all : COURSES);
    } catch (error) {
      console.error('Error fetching courses for category:', error);
      setCourses(COURSES);
      // Only surface the error screen when the bundled catalogue has nothing
      // for this category either — otherwise the page is perfectly usable and
      // an error state would be noise.
      setLoadFailed(!COURSES.some(c => c.categoryId === id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCategoryCourses();
  }, [loadCategoryCourses]);

  const progress = useMemo(() => storageService.getAllProgress(), []);

  const categoryCourses = useMemo(
    () => courses.filter(course => course.categoryId === id),
    [courses, id]
  );

  const categoryTitle = category
    ? t(`categoryView.categories.${category.id}.title`, { defaultValue: category.title })
    : '';
  const categoryDescription = category
    ? t(`categoryView.categories.${category.id}.description`, { defaultValue: category.description })
    : '';

  if (!category) {
    return <NotFound />;
  }

  if (loading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center">
        <Loader2 className="animate-spin text-primaryLight w-12 h-12" />
        <div className="mt-4 text-textMuted text-sm font-medium animate-pulse">
          {t('categoryView.loading')}
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return <CourseLoadError onRetry={loadCategoryCourses} />;
  }

  return (
    <div className="animate-fade-in">
      <Link
        to="/"
        className="inline-flex items-center text-textMuted hover:text-textMain mb-8 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight"
      >
        <ArrowLeft size={20} className="mr-2" /> {t('categoryView.backToDashboard')}
      </Link>

      <div className="mb-12">
        <h1 className="text-4xl font-display font-bold text-textMain mb-4">{categoryTitle}</h1>
        <p className="text-xl text-textMuted max-w-2xl">{categoryDescription}</p>
      </div>

      {categoryCourses.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <BookOpen className="text-primaryLight" size={28} />
          </div>
          <h2 className="text-xl font-bold text-textMain mb-2">No courses in this category yet</h2>
          <p className="text-textMuted mb-6 max-w-md mx-auto">
            Nothing has been published here so far. Browse the full catalogue in the meantime.
          </p>
          <Link
            to="/courses"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-main text-white font-bold shadow hover:scale-105 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <BookOpen size={16} /> {t('courses.title')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categoryCourses.map(course => {
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
                isBookmarked={bookmarkedIds.includes(course.id)}
                onToggleBookmark={courseBookmarks.toggleBookmark}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
