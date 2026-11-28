// A radix-2 complex FFT in double precision, in place. Sizes must be powers of two.

interface Plan {
    rev: Uint32Array;
    cos: Float64Array;
    sin: Float64Array;
}

const plans = new Map<number, Plan>();

function plan(n: number): Plan {
    let p = plans.get(n);
    if (p) return p;
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size ${n} is not a power of two`);
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
        let x = i;
        let r = 0;
        for (let b = 0; b < bits; b++) {
            r = (r << 1) | (x & 1);
            x >>= 1;
        }
        rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
        cos[i] = Math.cos((2 * Math.PI * i) / n);
        sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    p = { rev, cos, sin };
    plans.set(n, p);
    return p;
}

/** Forward transform: X[k] = Σ x[n]·e^(−2πikn/N). */
export function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    const { rev, cos, sin } = plan(n);
    for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
            let t = re[i];
            re[i] = re[j];
            re[j] = t;
            t = im[i];
            im[i] = im[j];
            im[j] = t;
        }
    }
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
            for (let j = start, k = 0; j < start + half; j++, k += step) {
                const l = j + half;
                const tre = re[l] * cos[k] + im[l] * sin[k];
                const tim = im[l] * cos[k] - re[l] * sin[k];
                re[l] = re[j] - tre;
                im[l] = im[j] - tim;
                re[j] += tre;
                im[j] += tim;
            }
        }
    }
}

/** Inverse transform, scaled by 1/N. */
export function ifft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] = -im[i] / n;
    }
}
