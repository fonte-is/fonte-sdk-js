use super::StoreError;
use core_foundation_sys::array::{
    kCFTypeArrayCallBacks, CFArrayCreate, CFArrayGetCount, CFArrayGetTypeID,
    CFArrayGetValueAtIndex, CFArrayRef,
};
use core_foundation_sys::base::{kCFAllocatorDefault, CFGetTypeID, CFRelease, CFTypeRef};
use core_foundation_sys::data::{
    CFDataCreate, CFDataGetBytePtr, CFDataGetLength, CFDataGetTypeID, CFDataRef,
};
use core_foundation_sys::dictionary::{
    kCFTypeDictionaryKeyCallBacks, kCFTypeDictionaryValueCallBacks, CFDictionaryCreate,
    CFDictionaryRef,
};
use core_foundation_sys::number::{kCFBooleanFalse, kCFBooleanTrue};
use core_foundation_sys::string::{kCFStringEncodingUTF8, CFStringCreateWithBytes, CFStringRef};
use security_framework_sys::base::{
    errSecDuplicateItem, errSecItemNotFound, errSecSuccess, SecKeychainRef,
};
use security_framework_sys::item::{
    kSecAttrAccount, kSecAttrService, kSecAttrSynchronizable, kSecClass, kSecClassGenericPassword,
    kSecMatchLimit, kSecMatchLimitAll, kSecMatchSearchList, kSecReturnData,
    kSecUseAuthenticationUI, kSecUseKeychain, kSecValueData,
};
use security_framework_sys::keychain::SecKeychainCopyDefault;
use security_framework_sys::keychain_item::{SecItemAdd, SecItemCopyMatching, SecItemUpdate};
use std::os::raw::c_void;
use std::ptr;

const SERVICE: &str = "is.fonte.client-auth";
const USER: &str = "customer-session-v1";
const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;

extern "C" {
    static kSecUseAuthenticationUIFail: CFStringRef;
}

pub fn read() -> Result<Option<Vec<u8>>, StoreError> {
    unsafe { read_with_policy(false) }
}

pub fn replace(payload: &[u8], permit_interaction: bool) -> Result<(), StoreError> {
    unsafe {
        let present = read_with_policy(permit_interaction)?.is_some();
        if present {
            return update(payload, permit_interaction);
        }

        let query = Query::new(permit_interaction, false, Some(payload))?;
        let status = SecItemAdd(query.dictionary(), ptr::null_mut());
        if status == errSecDuplicateItem {
            return update(payload, permit_interaction);
        }
        map_status(status)
    }
}

unsafe fn read_with_policy(permit_interaction: bool) -> Result<Option<Vec<u8>>, StoreError> {
    let query = Query::new(permit_interaction, true, None)?;
    let mut result: CFTypeRef = ptr::null();
    let status = SecItemCopyMatching(query.dictionary(), &mut result);
    if status == errSecItemNotFound {
        return Ok(None);
    }
    map_status(status)?;
    if result.is_null() {
        return Err(StoreError::Invalid);
    }
    let result = OwnedCf(result);
    if CFGetTypeID(result.0) != CFArrayGetTypeID() {
        return Err(StoreError::Invalid);
    }
    let array = result.0 as CFArrayRef;
    if CFArrayGetCount(array) != 1 {
        return Err(StoreError::Invalid);
    }
    let value = CFArrayGetValueAtIndex(array, 0) as CFTypeRef;
    if value.is_null() || CFGetTypeID(value) != CFDataGetTypeID() {
        return Err(StoreError::Invalid);
    }
    let data = value as CFDataRef;
    let length = CFDataGetLength(data);
    if length <= 0 {
        return Err(StoreError::Invalid);
    }
    Ok(Some(
        std::slice::from_raw_parts(CFDataGetBytePtr(data), length as usize).to_vec(),
    ))
}

unsafe fn update(payload: &[u8], permit_interaction: bool) -> Result<(), StoreError> {
    let query = Query::new(permit_interaction, false, None)?;
    let data = data(payload)?;
    let attributes = dictionary(&[(kSecValueData as CFTypeRef, data.0 as CFTypeRef)])?;
    map_status(SecItemUpdate(
        query.dictionary(),
        attributes.0 as CFDictionaryRef,
    ))
}

fn map_status(status: i32) -> Result<(), StoreError> {
    if status == errSecSuccess {
        Ok(())
    } else if status == ERR_SEC_INTERACTION_NOT_ALLOWED {
        Err(StoreError::InteractionRequired)
    } else {
        Err(StoreError::Unavailable)
    }
}

struct Query {
    _owned: Vec<OwnedCf>,
    dictionary: OwnedCf,
}

impl Query {
    unsafe fn new(
        permit_interaction: bool,
        return_data: bool,
        payload: Option<&[u8]>,
    ) -> Result<Self, StoreError> {
        let service = string(SERVICE)?;
        let user = string(USER)?;

        let mut keychain: SecKeychainRef = ptr::null_mut();
        map_status(SecKeychainCopyDefault(&mut keychain))?;
        if keychain.is_null() {
            return Err(StoreError::Unavailable);
        }
        let keychain = OwnedCf(keychain as CFTypeRef);
        let search_list = array(&[keychain.0])?;

        let mut pairs = vec![
            (
                kSecClass as CFTypeRef,
                kSecClassGenericPassword as CFTypeRef,
            ),
            (kSecAttrService as CFTypeRef, service.0),
            (kSecAttrAccount as CFTypeRef, user.0),
            (
                kSecAttrSynchronizable as CFTypeRef,
                kCFBooleanFalse as CFTypeRef,
            ),
        ];
        if payload.is_some() {
            pairs.push((kSecUseKeychain as CFTypeRef, keychain.0));
        } else {
            pairs.push((kSecMatchSearchList as CFTypeRef, search_list.0));
        }
        if !permit_interaction {
            pairs.push((
                kSecUseAuthenticationUI as CFTypeRef,
                kSecUseAuthenticationUIFail as CFTypeRef,
            ));
        }
        if return_data {
            pairs.push((kSecMatchLimit as CFTypeRef, kSecMatchLimitAll as CFTypeRef));
            pairs.push((kSecReturnData as CFTypeRef, kCFBooleanTrue as CFTypeRef));
        }
        let mut owned = vec![service, user, keychain, search_list];
        if let Some(payload) = payload {
            let value = data(payload)?;
            pairs.push((kSecValueData as CFTypeRef, value.0));
            owned.push(value);
        }
        let dictionary = dictionary(&pairs)?;
        Ok(Self {
            _owned: owned,
            dictionary,
        })
    }

    fn dictionary(&self) -> CFDictionaryRef {
        self.dictionary.0 as CFDictionaryRef
    }
}

struct OwnedCf(CFTypeRef);

impl Drop for OwnedCf {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

unsafe fn string(value: &str) -> Result<OwnedCf, StoreError> {
    let string = CFStringCreateWithBytes(
        kCFAllocatorDefault,
        value.as_ptr(),
        value.len() as isize,
        kCFStringEncodingUTF8,
        0,
    );
    if string.is_null() {
        Err(StoreError::Unavailable)
    } else {
        Ok(OwnedCf(string as CFTypeRef))
    }
}

unsafe fn data(value: &[u8]) -> Result<OwnedCf, StoreError> {
    let data = CFDataCreate(kCFAllocatorDefault, value.as_ptr(), value.len() as isize);
    if data.is_null() {
        Err(StoreError::Unavailable)
    } else {
        Ok(OwnedCf(data as CFTypeRef))
    }
}

unsafe fn array(values: &[CFTypeRef]) -> Result<OwnedCf, StoreError> {
    let array = CFArrayCreate(
        kCFAllocatorDefault,
        values.as_ptr() as *const *const c_void,
        values.len() as isize,
        &kCFTypeArrayCallBacks,
    );
    if array.is_null() {
        Err(StoreError::Unavailable)
    } else {
        Ok(OwnedCf(array as CFTypeRef))
    }
}

unsafe fn dictionary(values: &[(CFTypeRef, CFTypeRef)]) -> Result<OwnedCf, StoreError> {
    let keys: Vec<*const c_void> = values.iter().map(|pair| pair.0).collect();
    let entries: Vec<*const c_void> = values.iter().map(|pair| pair.1).collect();
    let dictionary = CFDictionaryCreate(
        kCFAllocatorDefault,
        keys.as_ptr(),
        entries.as_ptr(),
        values.len() as isize,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks,
    );
    if dictionary.is_null() {
        Err(StoreError::Unavailable)
    } else {
        Ok(OwnedCf(dictionary as CFTypeRef))
    }
}
