/**
 * JSON Schema for structured-output degree parsing. Mirrors DegreeProgram in
 * shared/types.ts — keep the two in sync.
 */
export const DEGREE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'totalCredits', 'groups'],
  properties: {
    name: { type: 'string', description: 'Official program name, e.g. "B.S. in Computer Science"' },
    type: { type: 'string', enum: ['major', 'minor', 'certificate', 'other'] },
    totalCredits: {
      type: ['number', 'null'],
      description: 'Total credits/units required for the program, null if not stated',
    },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'rule', 'courses', 'notes'],
        properties: {
          title: { type: 'string', description: 'Requirement group heading, e.g. "Core Courses"' },
          rule: {
            type: 'object',
            additionalProperties: false,
            required: ['kind'],
            properties: {
              kind: {
                type: 'string',
                enum: ['all', 'chooseN', 'credits'],
                description:
                  '"all" = every listed course required; "chooseN" = pick n courses; "credits" = earn a number of credits from the list',
              },
              n: { type: 'number', description: 'Number of courses to choose (chooseN only)' },
              credits: { type: 'number', description: 'Credits required from this group (credits only)' },
            },
          },
          courses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['code', 'title', 'credits', 'prereqCodes', 'equivalents'],
              properties: {
                code: {
                  type: 'string',
                  description: 'Normalized course code: DEPT NUMBER, e.g. "CS 2110"',
                },
                title: { type: ['string', 'null'] },
                credits: { type: ['number', 'null'] },
                prereqCodes: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Course codes listed as prerequisites for this course, if stated',
                },
                equivalents: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Alternative course codes that also satisfy this requirement when the catalog says "X or Y", "or equivalent", or names an AP/transfer equivalent. Empty if none.',
                },
              },
            },
          },
          notes: {
            type: ['string', 'null'],
            description: 'Constraints not expressible in the rule, e.g. GPA minimums',
          },
        },
      },
    },
  },
} as const;
