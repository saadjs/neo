declare const __GIT_COMMIT__: string;
declare const __GIT_COMMIT_DATE__: string;

export const GIT_COMMIT = typeof __GIT_COMMIT__ !== "undefined" ? __GIT_COMMIT__ : "dev";
export const GIT_COMMIT_DATE =
  typeof __GIT_COMMIT_DATE__ !== "undefined" ? __GIT_COMMIT_DATE__ : "";
