/// <reference types="vite/client" />

declare module "*.sm?raw" {
  const content: string;
  export default content;
}

declare module "*.ogg" {
  const content: string;
  export default content;
}
