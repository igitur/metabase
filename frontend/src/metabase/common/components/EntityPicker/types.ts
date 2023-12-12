export type PickerState<T> = PickerStateItem<T>[];

export type PickerStateItem<T> = {
  items: (Partial<T> & { model: string })[];
  selectedItem: Partial<T> & { model: string } | null;
};
