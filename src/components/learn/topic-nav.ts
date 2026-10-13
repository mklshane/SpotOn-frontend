import { router } from 'expo-router';

import { getTopicReadMinutes, type Topic } from '@/data/learn-content';
import { t } from '@/lib/i18n';

/** Opens a topic: its article directly, or the list of guides it groups. */
export function openTopic(topic: Topic) {
  switch (topic.kind) {
    case 'article':
      router.push({ pathname: '/learn/article', params: { topicId: topic.id } });
      return;
    case 'subtopics':
      router.push({ pathname: '/learn/topic', params: { topicId: topic.id } });
      return;
    default:
      // Exhaustiveness check: a compile error here means a new Topic kind was
      // added without teaching openTopic where it should navigate.
      topic satisfies never;
  }
}

/** "3 min read", or "3 guides" for a topic that groups several articles. */
export function topicLengthLabel(topic: Topic): string {
  if (topic.kind === 'subtopics') {
    return t('{{count}} guides', { count: topic.subtopics.length });
  }
  return t('{{count}} min read', { count: getTopicReadMinutes(topic) });
}
