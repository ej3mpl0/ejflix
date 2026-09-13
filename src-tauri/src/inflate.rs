//! Minimal gzip / DEFLATE decoder (RFC 1951, RFC 1952) so compressed XMLTV guides
//! (`.xml.gz`, the usual way EPG files are served) work without a compression crate.
//! Bit-by-bit canonical Huffman decoding in the style of zlib's `puff.c`: slow-ish but
//! small, and guides are decoded once per refresh on a background task.

const MAX_BITS: usize = 15;
const LBASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
    131, 163, 195, 227, 258,
];
const LEXT: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DBASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DEXT: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];
/// Order in which the code-length code lengths are stored in a dynamic block header.
const ORDER: [usize; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

pub fn is_gzip(data: &[u8]) -> bool {
    data.len() >= 2 && data[0] == 0x1f && data[1] == 0x8b
}

/// Decompresses one or more concatenated gzip members. `max_out` bounds the output so a
/// hostile or absurd file cannot exhaust memory.
pub fn gunzip(data: &[u8], max_out: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut pos = 0;
    let mut members = 0;
    while pos + 18 <= data.len() && data[pos] == 0x1f && data[pos + 1] == 0x8b {
        if data[pos + 2] != 8 {
            return Err("gzip: método de compresión no soportado".into());
        }
        let flags = data[pos + 3];
        pos += 10;
        if flags & 0x04 != 0 {
            let xlen = u16::from_le_bytes([data[pos], data[pos + 1]]) as usize;
            pos += 2 + xlen;
        }
        if flags & 0x08 != 0 {
            pos = skip_zero_terminated(data, pos)?;
        }
        if flags & 0x10 != 0 {
            pos = skip_zero_terminated(data, pos)?;
        }
        if flags & 0x02 != 0 {
            pos += 2;
        }
        if pos > data.len() {
            return Err("gzip: cabecera truncada".into());
        }
        let before = out.len();
        let mut reader = BitReader::new(&data[pos..]);
        inflate(&mut reader, &mut out, max_out)?;
        let consumed = reader.bytes_consumed();
        pos += consumed;
        // Trailer: CRC32 (ignored) and the size of this member modulo 2^32.
        if pos + 8 > data.len() {
            return Err("gzip: archivo truncado".into());
        }
        let isize = u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]]);
        if ((out.len() - before) as u32) != isize {
            return Err("gzip: tamaño incorrecto".into());
        }
        pos += 8;
        members += 1;
    }
    if members == 0 {
        return Err("No es un archivo gzip".into());
    }
    Ok(out)
}

fn skip_zero_terminated(data: &[u8], mut pos: usize) -> Result<usize, String> {
    while pos < data.len() && data[pos] != 0 {
        pos += 1;
    }
    if pos >= data.len() {
        return Err("gzip: cabecera truncada".into());
    }
    Ok(pos + 1)
}

struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
    buf: u64,
    nbits: u32,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            pos: 0,
            buf: 0,
            nbits: 0,
        }
    }

    fn bits(&mut self, n: u32) -> Result<u32, String> {
        while self.nbits < n {
            let Some(&byte) = self.data.get(self.pos) else {
                return Err("deflate: datos truncados".into());
            };
            self.pos += 1;
            self.buf |= (byte as u64) << self.nbits;
            self.nbits += 8;
        }
        let value = (self.buf & ((1u64 << n) - 1)) as u32;
        self.buf >>= n;
        self.nbits -= n;
        Ok(value)
    }

    fn align(&mut self) {
        let drop = self.nbits % 8;
        self.buf >>= drop;
        self.nbits -= drop;
    }

    /// Bytes consumed from the input, not counting whole bytes still in the buffer.
    fn bytes_consumed(&self) -> usize {
        self.pos - (self.nbits / 8) as usize
    }
}

struct Huffman {
    count: [u16; MAX_BITS + 1],
    symbol: Vec<u16>,
}

impl Huffman {
    fn new(lengths: &[u8]) -> Result<Self, String> {
        let mut count = [0u16; MAX_BITS + 1];
        for &len in lengths {
            count[len as usize] += 1;
        }
        // Over-subscribed code lengths cannot form a prefix code.
        let mut left: i32 = 1;
        for len in 1..=MAX_BITS {
            left <<= 1;
            left -= count[len] as i32;
            if left < 0 {
                return Err("deflate: tabla de Huffman no válida".into());
            }
        }
        let mut offsets = [0u16; MAX_BITS + 2];
        for len in 1..=MAX_BITS {
            offsets[len + 1] = offsets[len] + count[len];
        }
        let mut symbol = vec![0u16; lengths.len()];
        for (sym, &len) in lengths.iter().enumerate() {
            if len != 0 {
                symbol[offsets[len as usize] as usize] = sym as u16;
                offsets[len as usize] += 1;
            }
        }
        Ok(Self { count, symbol })
    }

    fn decode(&self, reader: &mut BitReader) -> Result<u16, String> {
        let mut code: i32 = 0;
        let mut first: i32 = 0;
        let mut index: i32 = 0;
        for len in 1..=MAX_BITS {
            code |= reader.bits(1)? as i32;
            let count = self.count[len] as i32;
            if code - count < first {
                return Ok(self.symbol[(index + (code - first)) as usize]);
            }
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        Err("deflate: código no válido".into())
    }
}

fn inflate(reader: &mut BitReader, out: &mut Vec<u8>, max_out: usize) -> Result<(), String> {
    loop {
        let last = reader.bits(1)? == 1;
        match reader.bits(2)? {
            0 => stored(reader, out, max_out)?,
            1 => {
                let (lit, dist) = fixed_tables()?;
                codes(reader, out, max_out, &lit, &dist)?;
            }
            2 => {
                let (lit, dist) = dynamic_tables(reader)?;
                codes(reader, out, max_out, &lit, &dist)?;
            }
            _ => return Err("deflate: tipo de bloque no válido".into()),
        }
        if last {
            return Ok(());
        }
    }
}

fn stored(reader: &mut BitReader, out: &mut Vec<u8>, max_out: usize) -> Result<(), String> {
    reader.align();
    let len = reader.bits(16)? as usize;
    let nlen = reader.bits(16)? as usize;
    if len != (!nlen & 0xffff) {
        return Err("deflate: bloque almacenado corrupto".into());
    }
    if out.len() + len > max_out {
        return Err("deflate: archivo demasiado grande".into());
    }
    for _ in 0..len {
        out.push(reader.bits(8)? as u8);
    }
    Ok(())
}

fn fixed_tables() -> Result<(Huffman, Huffman), String> {
    let mut lengths = [0u8; 288];
    for (i, len) in lengths.iter_mut().enumerate() {
        *len = match i {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    let lit = Huffman::new(&lengths)?;
    let dist = Huffman::new(&[5u8; 30])?;
    Ok((lit, dist))
}

fn dynamic_tables(reader: &mut BitReader) -> Result<(Huffman, Huffman), String> {
    let nlen = reader.bits(5)? as usize + 257;
    let ndist = reader.bits(5)? as usize + 1;
    let ncode = reader.bits(4)? as usize + 4;
    if nlen > 286 || ndist > 30 {
        return Err("deflate: cabecera de bloque no válida".into());
    }
    let mut lengths = [0u8; 19];
    for &index in ORDER.iter().take(ncode) {
        lengths[index] = reader.bits(3)? as u8;
    }
    let lencode = Huffman::new(&lengths)?;
    let mut all = vec![0u8; nlen + ndist];
    let mut index = 0;
    while index < nlen + ndist {
        let symbol = lencode.decode(reader)?;
        match symbol {
            0..=15 => {
                all[index] = symbol as u8;
                index += 1;
            }
            16 => {
                if index == 0 {
                    return Err("deflate: repetición sin longitud previa".into());
                }
                let previous = all[index - 1];
                let repeat = 3 + reader.bits(2)? as usize;
                fill(&mut all, &mut index, previous, repeat)?;
            }
            17 => {
                let repeat = 3 + reader.bits(3)? as usize;
                fill(&mut all, &mut index, 0, repeat)?;
            }
            _ => {
                let repeat = 11 + reader.bits(7)? as usize;
                fill(&mut all, &mut index, 0, repeat)?;
            }
        }
    }
    if all[256] == 0 {
        return Err("deflate: falta el código de fin de bloque".into());
    }
    let lit = Huffman::new(&all[..nlen])?;
    let dist = Huffman::new(&all[nlen..])?;
    Ok((lit, dist))
}

fn fill(all: &mut [u8], index: &mut usize, value: u8, repeat: usize) -> Result<(), String> {
    if *index + repeat > all.len() {
        return Err("deflate: demasiadas longitudes".into());
    }
    for slot in &mut all[*index..*index + repeat] {
        *slot = value;
    }
    *index += repeat;
    Ok(())
}

fn codes(
    reader: &mut BitReader,
    out: &mut Vec<u8>,
    max_out: usize,
    lit: &Huffman,
    dist: &Huffman,
) -> Result<(), String> {
    loop {
        let symbol = lit.decode(reader)? as usize;
        if symbol < 256 {
            if out.len() >= max_out {
                return Err("deflate: archivo demasiado grande".into());
            }
            out.push(symbol as u8);
            continue;
        }
        if symbol == 256 {
            return Ok(());
        }
        let symbol = symbol - 257;
        if symbol >= LBASE.len() {
            return Err("deflate: código de longitud no válido".into());
        }
        let len = LBASE[symbol] as usize + reader.bits(LEXT[symbol] as u32)? as usize;
        let dsym = dist.decode(reader)? as usize;
        if dsym >= DBASE.len() {
            return Err("deflate: código de distancia no válido".into());
        }
        let distance = DBASE[dsym] as usize + reader.bits(DEXT[dsym] as u32)? as usize;
        if distance > out.len() {
            return Err("deflate: distancia fuera del búfer".into());
        }
        if out.len() + len > max_out {
            return Err("deflate: archivo demasiado grande".into());
        }
        let start = out.len() - distance;
        for i in 0..len {
            let byte = out[start + i];
            out.push(byte);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unhex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    // Vectors produced with Python's gzip module (mtime=0).
    const FIXED: &str = "1f8b08000000000002ffcb48cdc9c957c84027b93246c58785380083892fc6e0010000";
    const STORED: &str = "1f8b08000000000004ff011a00e5ff3c74763e3c6368616e6e656c2069643d2261222f3e3c2f74763e64aa8db91a000000";
    const DYNAMIC: &str = concat!(
        "1f8b08000000000002ff8d565b6ec3300cbb4ad0130cc57e7798a00bba016d5a24be3fb6c9732452749a1f37b5153d288a4ef92eb769b87c8df33cdd86b58c4bd9feddc6f9fa719ad6937c3abf9ddf87cf69bd08fbe7f2b82ee3fd3e552b5b7ccfed6a3c70b296c733d8ee3f790e14c2f654d6766031ec89ec6a3ee4bf65560c2a84c83c7916f5b0ae84942adf33b7a505f875694bc61553b197cc5221aff66a6621585d2d0f02cf73f3845e00159ced74bc416f2674e0f162ce9d02cd4b2c0359ec866dbffd1ec128b493fb6f68e483488ff8cc6ca07a727365bb24d1b0e0ee1cc836f966fdaf069b984a7e3c25ce58b20a53c6d4e36bffbe7d430d3ea5c78611a830488e10bddf0c426c4d0de728522c546c46812bbda6a9e90525cc048e44838815c38d983eb1507ea00943d7515fd0bf241be01c4c49d129bdac6bb8cf9c51049061bb12864572f14148c06de8b41c62a8f6c0bd1580a06973a2e4f900ebdd560688133b1c104189fe454372cdfd60ae837686308094ba6da076ad148711dde5767f94baf29e1065b57190a2ee4bad153a90a8804ceb7e5401f63dc52279969dcbd75728408c0fb18e4550499a33a2fb4d163f353612e579ffb3f8010ad40c86b40a0000"
    );

    #[test]
    fn fixed_block() {
        let plain = "hello hello hello hello
".repeat(20);
        assert_eq!(gunzip(&unhex(FIXED), 1 << 20).unwrap(), plain.as_bytes());
    }

    #[test]
    fn stored_block() {
        assert_eq!(gunzip(&unhex(STORED), 1 << 20).unwrap(), b"<tv><channel id=\"a\"/></tv>");
    }

    #[test]
    fn dynamic_block() {
        let out = gunzip(&unhex(DYNAMIC), 1 << 20).unwrap();
        assert_eq!(out.len(), 2740);
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with("channel") || text.contains(" programme "));
        assert!(text.contains("lang=\"es\""));
        // Every token must be one of the words the sample was built from.
        for word in text.split(' ') {
            assert!(
                ["programme", "channel", "title", "desc", "start", "stop", "2024", "lang=\"es\""].contains(&word),
                "unexpected token {word:?}"
            );
        }
    }

    #[test]
    fn rejects_garbage_and_size_limit() {
        assert!(gunzip(b"not gzip at all", 1 << 20).is_err());
        assert!(gunzip(&unhex(FIXED), 16).is_err());
        let mut truncated = unhex(DYNAMIC);
        truncated.truncate(truncated.len() / 2);
        assert!(gunzip(&truncated, 1 << 20).is_err());
    }
}
