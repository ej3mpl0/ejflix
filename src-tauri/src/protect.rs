use std::ffi::c_void;
use std::ptr;

#[repr(C)]
struct DataBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

#[link(name = "crypt32")]
extern "system" {
    fn CryptProtectData(
        data_in: *const DataBlob,
        descr: *const u16,
        entropy: *const DataBlob,
        reserved: *mut c_void,
        prompt: *const c_void,
        flags: u32,
        data_out: *mut DataBlob,
    ) -> i32;
    fn CryptUnprotectData(
        data_in: *const DataBlob,
        descr: *mut *mut u16,
        entropy: *const DataBlob,
        reserved: *mut c_void,
        prompt: *const c_void,
        flags: u32,
        data_out: *mut DataBlob,
    ) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(mem: *mut c_void) -> *mut c_void;
}

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn protect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let input = DataBlob {
        cb_data: bytes.len() as u32,
        pb_data: bytes.as_ptr() as *mut u8,
    };
    let descr = to_wide("ejFlix");
    let mut output = DataBlob {
        cb_data: 0,
        pb_data: ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            descr.as_ptr(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("No se pudo cifrar la sesión".into());
    }
    let copy = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) }.to_vec();
    unsafe {
        LocalFree(output.pb_data as *mut c_void);
    }
    Ok(copy)
}

pub fn unprotect(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let input = DataBlob {
        cb_data: bytes.len() as u32,
        pb_data: bytes.as_ptr() as *mut u8,
    };
    let mut output = DataBlob {
        cb_data: 0,
        pb_data: ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err("No se pudo leer la sesión cifrada".into());
    }
    let copy = unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize) }.to_vec();
    unsafe {
        LocalFree(output.pb_data as *mut c_void);
    }
    Ok(copy)
}

pub fn to_hex(data: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(data.len() * 2);
    for byte in data {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

pub fn from_hex(text: &str) -> Result<Vec<u8>, String> {
    if text.len() % 2 != 0 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Sesión corrupta".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).map_err(|_| "Sesión corrupta".into()))
        .collect()
}
