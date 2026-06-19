export type AnnotationPrimitive = string | number | boolean | null;

export type AnnotationValue =
  | AnnotationPrimitive
  | AnnotationValue[]
  | { [key: string]: AnnotationValue };

export type Annotations = Record<string, AnnotationValue>;
