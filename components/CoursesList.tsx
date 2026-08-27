import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronDown, Bookmark, ArrowUpDown, X } from 'lucide-react';
import { isCourseUnlocked, getIncompletePrerequisites } from '../utils/prerequisites';
import { CATEGORIES, COURSES } from '../constants';
import { storageService } from '../services/storageService';
import { firestoreService } from '../services/firestoreService';
import { courseBookmarks } from '../utils/courseBookmarks';
import { useBookmarks } from '../hooks/useBookmarks';
import { Course } from '../types';
import { CourseCard } from './ui/CourseCard';

type SortOption = 'default' | 'rating' | 'reviews' | 'az';
type LevelFilter = 'all' | 'Beginner' | 'Intermediate' | 'Advanced';
type TimeFilter = 'all' | 'under30' | '30to60' | '1to2h' | '2hplus';

export const CoursesList: React.FC = () => {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>(COURSES);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterLevel, setFilterLevel] = useState<LevelFilter>('all');
  const [filterTime, setFilterTime] = useState<TimeFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [savedOnly, setSavedOnly] = useState(false);
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

  /**
   * Parse a human-readable duration string such as "8 Hours", "45 Minutes",
   * or "1.5 Hours" into a total number of minutes for bucketing purposes.
   * Falls back to 0 if the string cannot be parsed.
   */
  const parseDurationMinutes = (duration: string): number => {
    const lower = duration.toLowerCase().trim();
    const numMatch = lower.match(/([\d.]+)/);
    if (!numMatch) return 0;
    const value = parseFloat(numMatch[1]);
    if (lower.includes('hour')) return Math.round(value * 60);
    if (lower.includes('min')) return Math.round(value);
    // Fallback: treat bare numbers as hours (matches existing "8 Hours" format)
    return Math.round(value * 60);
  };

  const getCategoryLabel = (categoryId: string) => {
    switch (categoryId) {
      case 'programming':
        return t('courses.categories.programming');
      case 'dsa':
        return t('courses.categories.dsa');
      case 'design':
        return t('courses.categories.design');
      default:
        return t('courses.categories.default');
    }
  };

  const filtered = courses
    .filter(course => {
      const q = search.toLowerCase();
      const matchesSearch =
        course.title.toLowerCase().includes(q) || course.description.toLowerCase().includes(q);
      const matchesCat = filterCat === 'all' || course.categoryId === filterCat;
      const matchesLevel = filterLevel === 'all' || course.level === filterLevel;
      const matchesSaved = !savedOnly || bookmarkedIds.includes(course.id);

      let matchesTime = true;
      if (filterTime !== 'all') {
        const mins = parseDurationMinutes(course.duration);
        if (filterTime === 'under30') matchesTime = mins < 30;
        else if (filterTime === '30to60') matchesTime = mins >= 30 && mins <= 60;
        else if (filterTime === '1to2h') matchesTime = mins > 60 && mins <= 120;
        else if (filterTime === '2hplus') matchesTime = mins > 120;
      }

      return matchesSearch && matchesCat && matchesLevel && matchesSaved && matchesTime;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'rating':
          return (b.rating ?? 0) - (a.rating ?? 0);
        case 'reviews':
          return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
        case 'az':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

  const hasActiveFilters =
    search !== '' || filterCat !== 'all' || filterLevel !== 'all' || filterTime !== 'all' || sortBy !== 'default' || savedOnly;

  const clearFilters = () => {
    setSearch('');
    setFilterCat('all');
    setFilterLevel('all');
    setFilterTime('all');
    setSortBy('default');
    setSavedOnly(false);
  };

  return (
    <div className="animate-fade-in space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-end md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-textMain mb-2">{t('courses.title')}</h1>
          <p className="text-textMuted">{t('courses.subtitle')}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-textMuted group-focus-within:text-primaryLight transition-colors" size={18} />
          <input
            type="text"
            placeholder={t('courses.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gradient-input border border-primary/20 dark:border-primary/20 rounded-xl py-3 pl-11 pr-4 text-black placeholder-textMuted focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight transition-all"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="relative group min-w-[160px]">
            <select
              value={filterCat}
              onChange={e => setFilterCat(e.target.value)}
              title={t('courses.filterTitle')}
              aria-label={t('courses.filterTitle')}
              className="w-full bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/20 rounded-xl py-3 pl-4 pr-10 text-textMain focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight appearance-none cursor-pointer transition-all"
            >
              <option value="all" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.allCategories')}</option>
              {CATEGORIES.map(c => (
                <option key={c.id} value={c.id} className="bg-white dark:bg-[#0B1220] text-textMain">{getCategoryLabel(c.id)}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none group-hover:text-primaryLight transition-colors" size={16} />
          </div>

          <div className="relative group min-w-[160px]">
            <select
              value={filterLevel}
              onChange={e => setFilterLevel(e.target.value as LevelFilter)}
              title={t('courses.difficultyFilterTitle')}
              aria-label={t('courses.difficultyFilterTitle')}
              className="w-full bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/20 rounded-xl py-3 pl-4 pr-10 text-textMain focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight appearance-none cursor-pointer transition-all"
            >
              <option value="all" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.allLevels')}</option>
              <option value="Beginner" className="bg-white dark:bg-[#0B1220] text-textMain">{t('common.difficulty.beginner')}</option>
              <option value="Intermediate" className="bg-white dark:bg-[#0B1220] text-textMain">{t('common.difficulty.intermediate')}</option>
              <option value="Advanced" className="bg-white dark:bg-[#0B1220] text-textMain">{t('common.difficulty.advanced')}</option>
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none group-hover:text-primaryLight transition-colors" size={16} />
          </div>

          <div className="relative group min-w-[160px]">
            <select
              value={filterTime}
              onChange={e => setFilterTime(e.target.value as TimeFilter)}
              title={t('courses.timeFilterTitle')}
              aria-label={t('courses.timeFilterTitle')}
              className="w-full bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/20 rounded-xl py-3 pl-4 pr-10 text-textMain focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight appearance-none cursor-pointer transition-all"
            >
              <option value="all" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.allDurations')}</option>
              <option value="under30" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.timeUnder30')}</option>
              <option value="30to60" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.time30to60')}</option>
              <option value="1to2h" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.time1to2h')}</option>
              <option value="2hplus" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.time2hPlus')}</option>
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none group-hover:text-primaryLight transition-colors" size={16} />
          </div>

          <div className="relative group min-w-[180px]">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortOption)}
              title={t('courses.sortTitle')}
              aria-label={t('courses.sortTitle')}
              className="w-full bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/20 rounded-xl py-3 pl-4 pr-10 text-textMain focus:outline-none focus:border-primaryLight focus:ring-1 focus:ring-primaryLight appearance-none cursor-pointer transition-all"
            >
              <option value="default" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.sortDefault')}</option>
              <option value="rating" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.sortRating')}</option>
              <option value="reviews" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.sortReviews')}</option>
              <option value="az" className="bg-white dark:bg-[#0B1220] text-textMain">{t('courses.sortAZ')}</option>
            </select>
            <ArrowUpDown className="absolute right-4 top-1/2 -translate-y-1/2 text-textMuted pointer-events-none group-hover:text-primaryLight transition-colors" size={14} />
          </div>

          <button
            onClick={() => setSavedOnly(prev => !prev)}
            aria-pressed={savedOnly}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl border font-semibold text-sm transition-all ${savedOnly
                ? 'bg-primary/20 border-primary/40 text-primaryLight'
                : 'bg-primary/5 dark:bg-primary/10 border-primary/20 dark:border-primary/20 text-textMuted hover:text-textMain'
              }`}
          >
            <Bookmark size={16} className={savedOnly ? 'fill-primaryLight' : ''} />
            {t('courses.savedOnly')}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-textMuted">
        <span>{t('courses.resultsCount', { count: filtered.length })}</span>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-primaryLight hover:underline font-semibold"
          >
            <X size={14} />
            {t('courses.clearFilters')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="bg-glass border border-black/20 dark:border-white/20 dark:border-white/10 rounded-2xl p-6 animate-pulse flex flex-col"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="h-6 w-20 rounded-full bg-white/10" />
                <div className="h-5 w-5 rounded-full bg-white/10" />
              </div>

              <div className="h-6 w-3/4 rounded bg-white/10 mb-3" />
              <div className="h-4 w-full rounded bg-white/10 mb-2" />
              <div className="h-4 w-5/6 rounded bg-white/10 mb-6 flex-1" />

              <div className="pt-4 border-t border-black/20 dark:border-white/5 flex items-center justify-between">
                <div className="h-4 w-16 rounded bg-white/10" />
                <div className="h-4 w-24 rounded bg-white/10" />
              </div>
            </div>
          ))
        ) : (
          <>
            {filtered.map(course => {
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

            {filtered.length === 0 && (
              <div className="col-span-full text-center py-20 text-textMuted">
                {t('courses.empty')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};