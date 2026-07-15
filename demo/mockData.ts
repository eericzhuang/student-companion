/**
 * Realistic sample data for the demo (a CS major + Math minor student mid-degree).
 */
import { DAYS, STORAGE_DEFAULTS, type Section, type StoredDegree } from '../src/shared/types';
import { parseMeetingPatterns } from '../src/shared/time';

const sec = (
  sectionId: string,
  courseCode: string,
  title: string,
  credits: number,
  instructor: string | null,
  pattern: string,
): Section => ({
  sectionId,
  courseCode,
  title,
  credits,
  instructor,
  meetings: parseMeetingPatterns(pattern),
});

export const mockSchedule: Section[] = [
  sec('CS 2110-001', 'CS 2110', 'Object-Oriented Programming & Data Structures', 4, 'Anne Bracy', 'MWF | 10:00 AM - 10:50 AM | Hollister 110'),
  sec('MATH 1920-002', 'MATH 1920', 'Multivariable Calculus', 4, 'David Mermin', 'TTh | 1:25 PM - 2:40 PM | Malott 251'),
  sec('PHYS 1112-003', 'PHYS 1112', 'Physics I: Mechanics', 4, 'Natasha Holmes', 'MW | 2:00 PM - 3:15 PM | Rockefeller 201'),
  sec('ENGL 2010-001', 'ENGL 2010', 'Writing Seminar', 3, 'Grace Chen', 'TTh | 10:10 AM - 11:25 AM | Goldwin 142'),
];

/** A search result the student is considering — conflicts with CS 2110. */
export const mockGhostConflict: Section = sec(
  'CS 3410-002',
  'CS 3410',
  'Computer System Organization',
  4,
  'Hakim Weatherspoon',
  'MWF | 10:00 AM - 10:50 AM | Statler Aud',
);

export const mockRmpTeachers = [
  { id: 't-bracy', firstName: 'Anne', lastName: 'Bracy', department: 'Computer Science', avgRating: 3.4, numRatings: 75 },
  { id: 't-other', firstName: 'Anna', lastName: 'Bracey', department: 'Mathematics', avgRating: 4.8, numRatings: 6 },
];

const c = (code: string, title: string, credits: number, prereqCodes: string[] = []) => ({
  code,
  title,
  credits,
  prereqCodes,
});

export const mockDegrees: StoredDegree[] = [
  {
    id: 'deg-cs',
    name: 'B.S. Computer Science',
    type: 'major',
    totalCredits: 120,
    sourceUrl: 'https://catalog.example.edu/cs-bs',
    parsedAt: Date.now(),
    userEdited: false,
    groups: [
      {
        title: 'Introductory Programming',
        rule: { kind: 'all' },
        courses: [c('CS 1110', 'Intro to Computing', 4), c('CS 2110', 'OOP & Data Structures', 4, ['CS 1110'])],
        notes: null,
      },
      {
        title: 'Core Systems',
        rule: { kind: 'all' },
        courses: [
          c('CS 3110', 'Functional Programming', 4, ['CS 2110']),
          c('CS 3410', 'Computer System Organization', 4, ['CS 2110']),
          c('CS 4410', 'Operating Systems', 4, ['CS 3410']),
        ],
        notes: null,
      },
      {
        title: 'Mathematics',
        rule: { kind: 'all' },
        courses: [c('MATH 1910', 'Calculus I', 4), c('MATH 1920', 'Multivariable Calculus', 4, ['MATH 1910']), c('MATH 2940', 'Linear Algebra', 4, ['MATH 1920'])],
        notes: null,
      },
      {
        title: 'CS Electives (choose 3)',
        rule: { kind: 'chooseN', n: 3 },
        courses: [c('CS 4780', 'Machine Learning', 4, ['MATH 2940']), c('CS 4820', 'Algorithms', 4, ['CS 2110']), c('CS 4700', 'Foundations of AI', 4), c('CS 5430', 'System Security', 4, ['CS 3410'])],
        notes: 'At least one 4000-level course must be taken in residence.',
      },
    ],
  },
  {
    id: 'deg-math',
    name: 'Mathematics Minor',
    type: 'minor',
    totalCredits: 20,
    sourceUrl: 'https://catalog.example.edu/math-minor',
    parsedAt: Date.now(),
    userEdited: false,
    groups: [
      {
        title: 'Calculus Sequence',
        rule: { kind: 'all' },
        courses: [c('MATH 1910', 'Calculus I', 4), c('MATH 1920', 'Multivariable Calculus', 4, ['MATH 1910']), c('MATH 2940', 'Linear Algebra', 4, ['MATH 1920'])],
        notes: null,
      },
      {
        title: 'Upper-level Math (choose 2)',
        rule: { kind: 'chooseN', n: 2 },
        courses: [c('MATH 3110', 'Real Analysis', 4, ['MATH 2940']), c('MATH 3360', 'Applicable Algebra', 4, ['MATH 2940']), c('CS 4820', 'Algorithms', 4, ['CS 2110'])],
        notes: null,
      },
    ],
  },
  {
    id: 'deg-ds',
    name: 'Data Science Minor',
    type: 'minor',
    totalCredits: 18,
    sourceUrl: 'https://catalog.example.edu/ds-minor',
    parsedAt: Date.now(),
    userEdited: false,
    groups: [
      {
        title: 'Foundations',
        rule: { kind: 'all' },
        courses: [c('CS 1110', 'Intro to Computing', 4), c('MATH 1910', 'Calculus I', 4), c('MATH 2940', 'Linear Algebra', 4, ['MATH 1920'])],
        notes: null,
      },
      {
        title: 'ML & Data (choose 2)',
        rule: { kind: 'chooseN', n: 2 },
        courses: [c('CS 4780', 'Machine Learning', 4, ['MATH 2940']), c('STSCI 3080', 'Probability & Inference', 4), c('ORIE 3120', 'Data Analytics Tools', 4)],
        notes: null,
      },
    ],
  },
];

/** A full researched program, attached to the demo AI-history entry so the
 *  "Show full requirements" expander can be previewed. */
export const mockResearchedDegree = {
  name: 'B.S. Data Science',
  type: 'major' as const,
  totalCredits: 120,
  groups: mockDegrees[2]!.groups,
};

/** What the student has already completed. */
export const mockHistory = {
  courses: [
    { code: 'CS 1110', title: 'Intro to Computing', credits: 4, grade: 'A', term: 'Fall 2024', status: 'completed' as const },
    { code: 'MATH 1910', title: 'Calculus I', credits: 4, grade: 'A-', term: 'Fall 2024', status: 'completed' as const },
    { code: 'MATH 1920', title: 'Multivariable Calculus', credits: 4, grade: 'B+', term: 'Spring 2025', status: 'completed' as const },
    { code: 'CS 2110', title: 'OOP & Data Structures', credits: 4, grade: null, term: 'Fall 2025', status: 'in-progress' as const },
  ],
  capturedAt: Date.now(),
  source: 'dom' as const,
};

export const mockStore = {
  ...STORAGE_DEFAULTS,
  schedule: { termLabel: 'Spring 2026', sections: mockSchedule, capturedAt: Date.now(), source: 'intercept' as const },
  academicHistory: mockHistory,
  degrees: Object.fromEntries(mockDegrees.map((d) => [d.id, d])),
  settings: {
    ...STORAGE_DEFAULTS.settings,
    rmpSchool: { id: 'U2Nob29sLTI5OA==', name: 'Cornell University' },
    terms: [
      { id: 'f26', label: 'Fall 2026', creditCap: 16 },
      { id: 's27', label: 'Spring 2027', creditCap: 16 },
      { id: 'f27', label: 'Fall 2027', creditCap: 16 },
    ],
  },
  plannerState: { includedDegreeIds: ['deg-cs', 'deg-math', 'deg-ds'], assignments: {} },
  aiHistory: [
    {
      id: 'demo-research-1',
      at: Date.now() - 40 * 60000,
      feature: 'degree-research' as const,
      title: 'Researched: B.S. Data Science @ Cornell University',
      detail: 'B.S. Data Science\n2 requirement group(s) · 120 total credits',
      degree: mockResearchedDegree,
    },
  ],
};
