export enum IssueType {
  VIDEO = 1,
  AUDIO = 2,
  SUBTITLES = 3,
  OTHER = 4,
}

export enum IssueStatus {
  OPEN = 1,
  RESOLVED = 2,
}

export const MAX_ISSUE_MESSAGE_LENGTH = 10_000;

export const IssueTypeName = {
  [IssueType.AUDIO]: 'Audio',
  [IssueType.VIDEO]: 'Video',
  [IssueType.SUBTITLES]: 'Subtitle',
  [IssueType.OTHER]: 'Other',
};
