use super::StoreError;
use std::ffi::c_void;
use std::ptr;
use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
use windows_sys::Win32::Security::Credentials::{
    CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

const TARGET: &str = "Fonte/is.fonte.client-auth/customer-session-v1";
const USER: &str = "customer-session-v1";

pub fn read() -> Result<Option<Vec<u8>>, StoreError> {
    let target = wide(TARGET);
    let mut raw: *mut CREDENTIALW = ptr::null_mut();
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) } == 0 {
        return match unsafe { GetLastError() } {
            ERROR_NOT_FOUND => Ok(None),
            _ => Err(StoreError::Unavailable),
        };
    }
    if raw.is_null() {
        return Err(StoreError::Invalid);
    }
    let _credential = Credential(raw);
    let credential = unsafe { &*raw };
    if credential.Type != CRED_TYPE_GENERIC
        || credential.Persist != CRED_PERSIST_LOCAL_MACHINE
        || credential.Flags != 0
        || unsafe { read_wide(credential.TargetName) }.as_deref() != Some(TARGET)
        || unsafe { read_wide(credential.UserName) }.as_deref() != Some(USER)
        || credential.CredentialBlob.is_null()
        || credential.CredentialBlobSize == 0
        || credential.CredentialBlobSize > 2_400
    {
        return Err(StoreError::Invalid);
    }
    Ok(Some(
        unsafe {
            std::slice::from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            )
        }
        .to_vec(),
    ))
}

pub fn replace(payload: &[u8], _permit_interaction: bool) -> Result<(), StoreError> {
    if payload.is_empty() || payload.len() > 2_400 {
        return Err(StoreError::Invalid);
    }
    let mut target = wide(TARGET);
    let mut user = wide(USER);
    let credential = CREDENTIALW {
        Flags: 0,
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        Comment: ptr::null_mut(),
        LastWritten: Default::default(),
        CredentialBlobSize: payload.len() as u32,
        CredentialBlob: payload.as_ptr() as *mut u8,
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        AttributeCount: 0,
        Attributes: ptr::null_mut(),
        TargetAlias: ptr::null_mut(),
        UserName: user.as_mut_ptr(),
    };
    if unsafe { CredWriteW(&credential, 0) } == 0 {
        return Err(StoreError::Unavailable);
    }
    Ok(())
}

struct Credential(*mut CREDENTIALW);

impl Drop for Credential {
    fn drop(&mut self) {
        unsafe { CredFree(self.0 as *const c_void) };
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

unsafe fn read_wide(value: *const u16) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let mut length = 0;
    while *value.add(length) != 0 {
        length += 1;
        if length > 4_096 {
            return None;
        }
    }
    String::from_utf16(std::slice::from_raw_parts(value, length)).ok()
}
