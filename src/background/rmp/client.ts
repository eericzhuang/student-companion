/**
 * RateMyProfessors unofficial GraphQL client. Runs in the background service
 * worker (host_permissions cover CORS). All RMP query shapes live here so API
 * drift is contained to this file.
 */
import type { RmpComment, RmpTeacher } from '../../shared/types';

const RMP_GRAPHQL = 'https://www.ratemyprofessors.com/graphql';
// Publicly known site token used by RMP's own frontend
const AUTH_HEADER = 'Basic dGVzdDp0ZXN0';

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(RMP_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: AUTH_HEADER,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`RMP request failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`RMP GraphQL error: ${body.errors[0]!.message}`);
  if (!body.data) throw new Error('RMP GraphQL returned no data');
  return body.data;
}

// ---------- School search ----------

const SCHOOL_SEARCH_QUERY = `
query SchoolSearch($query: SchoolSearchQuery!) {
  newSearch {
    schools(query: $query) {
      edges {
        node { id name city state numRatings }
      }
    }
  }
}`;

export interface SchoolResult {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  numRatings: number;
}

export async function searchSchools(text: string): Promise<SchoolResult[]> {
  const data = await gql<{
    newSearch: { schools: { edges: Array<{ node: SchoolResult }> } };
  }>(SCHOOL_SEARCH_QUERY, { query: { text } });
  return data.newSearch.schools.edges.map((e) => e.node);
}

// ---------- Teacher search ----------

const TEACHER_SEARCH_QUERY = `
query TeacherSearch($query: TeacherSearchQuery!) {
  newSearch {
    teachers(query: $query, first: 8) {
      edges {
        node {
          id
          firstName
          lastName
          department
          avgRating
          avgDifficulty
          wouldTakeAgainPercent
          numRatings
        }
      }
    }
  }
}`;

export interface TeacherSearchNode {
  id: string;
  firstName: string;
  lastName: string;
  department: string | null;
  avgRating: number | null;
  avgDifficulty: number | null;
  wouldTakeAgainPercent: number | null;
  numRatings: number;
}

export async function searchTeachers(
  text: string,
  schoolId: string,
): Promise<TeacherSearchNode[]> {
  const data = await gql<{
    newSearch: { teachers: { edges: Array<{ node: TeacherSearchNode }> } } | null;
  }>(TEACHER_SEARCH_QUERY, { query: { text, schoolID: schoolId } });
  return data.newSearch?.teachers?.edges.map((e) => e.node) ?? [];
}

// ---------- Teacher detail (ratings/comments) ----------

const TEACHER_RATINGS_QUERY = `
query TeacherRatings($id: ID!) {
  node(id: $id) {
    ... on Teacher {
      id
      firstName
      lastName
      department
      avgRating
      avgDifficulty
      wouldTakeAgainPercent
      numRatings
      ratings(first: 5) {
        edges {
          node {
            qualityRating
            difficultyRatingRounded
            class
            comment
            date
            thumbsUpTotal
          }
        }
      }
    }
  }
}`;

interface RatingNode {
  qualityRating: number | null;
  difficultyRatingRounded: number | null;
  class: string | null;
  comment: string | null;
  date: string | null;
  thumbsUpTotal: number | null;
}

export async function fetchTeacher(teacherId: string): Promise<RmpTeacher | null> {
  const data = await gql<{
    node:
      | (TeacherSearchNode & { ratings: { edges: Array<{ node: RatingNode }> } })
      | null;
  }>(TEACHER_RATINGS_QUERY, { id: teacherId });
  const node = data.node;
  if (!node) return null;

  const topComments: RmpComment[] = (node.ratings?.edges ?? [])
    .map((e) => e.node)
    .filter((r) => r.comment)
    .map((r) => ({
      quality: r.qualityRating,
      difficulty: r.difficultyRatingRounded,
      courseName: r.class,
      text: r.comment!.replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 600),
      date: r.date,
      thumbsUp: r.thumbsUpTotal ?? 0,
    }));

  return {
    teacherId: node.id,
    firstName: node.firstName,
    lastName: node.lastName,
    department: node.department,
    avgRating: node.avgRating,
    avgDifficulty: node.avgDifficulty,
    wouldTakeAgainPercent:
      node.wouldTakeAgainPercent != null && node.wouldTakeAgainPercent >= 0
        ? node.wouldTakeAgainPercent
        : null,
    numRatings: node.numRatings,
    topComments,
  };
}
