declare module 'safe-regex' {
  function safeRegex(pattern: string | RegExp): boolean;
  export default safeRegex;
}
