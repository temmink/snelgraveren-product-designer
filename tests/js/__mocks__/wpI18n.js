export const __ = (str) => str;
export const _x = (str) => str;
export const sprintf = (fmt, ...args) => {
    let i = 0;
    return fmt.replace(/%[sd]/g, () => args[i++]);
};
