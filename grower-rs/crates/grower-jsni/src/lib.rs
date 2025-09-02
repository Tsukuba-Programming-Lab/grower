use wasm_bindgen::prelude::wasm_bindgen;
use std::vec;

#[allow(unused_imports)]
use wasm_bindgen::JsValue;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JSNIKind {
    I8,
    I16,
    I32,
    I64,
    U8,
    U16,
    U32,
    U64,
    F32,
    F64,
    Bool,
    Char,
    String,
    VecU8,
    Null,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JSNIValue {
    pub kind: JSNIKind,
    pub value: u64,
}

macro_rules! impl_from_primitive {
    ($ty:ty, $kind:expr) => {
        impl From<$ty> for JSNIValue {
            fn from(value: $ty) -> Self {
                JSNIValue {
                    kind: $kind,
                    value: value as u64,
                }
            }
        }
    };
}

impl_from_primitive!(i8, JSNIKind::I8);
impl_from_primitive!(i16, JSNIKind::I16);
impl_from_primitive!(i32, JSNIKind::I32);
impl_from_primitive!(i64, JSNIKind::I64);
impl_from_primitive!(u8, JSNIKind::U8);
impl_from_primitive!(u16, JSNIKind::U16);
impl_from_primitive!(u32, JSNIKind::U32);
impl_from_primitive!(u64, JSNIKind::U64);
impl_from_primitive!(bool, JSNIKind::Bool);
impl_from_primitive!(char, JSNIKind::Char);

impl From<f32> for JSNIValue {
    fn from(value: f32) -> Self {
        let bytes = value.to_le_bytes();
        JSNIValue {
            kind: JSNIKind::F32,
            value: ((bytes[0] as u64) << 0)
                | ((bytes[1] as u64) << 8)
                | ((bytes[2] as u64) << 16)
                | ((bytes[3] as u64) << 24),
        }
    }
}

impl From<f64> for JSNIValue {
    fn from(value: f64) -> Self {
        let bytes = value.to_le_bytes();
        JSNIValue {
            kind: JSNIKind::F64,
            value: ((bytes[0] as u64) << 0)
                | ((bytes[1] as u64) << 8)
                | ((bytes[2] as u64) << 16)
                | ((bytes[3] as u64) << 24)
                | ((bytes[4] as u64) << 32)
                | ((bytes[5] as u64) << 40)
                | ((bytes[6] as u64) << 48)
                | ((bytes[7] as u64) << 56),
        }
    }
}

impl From<Vec<u8>> for JSNIValue {
    fn from(value: Vec<u8>) -> Self {
        let len = value.len();
        let ptr = value.as_ptr() as *mut u8;
        std::mem::forget(value); // Prevent Rust from freeing the memory
        JSNIValue {
            kind: JSNIKind::VecU8,
            // high: len 32bit, low: ptr 64bit
            value: (len as u64) << 32 | ptr as u64,
        }
    }
}

impl From<String> for JSNIValue {
    fn from(value: String) -> Self {
        let len = value.len();
        let bytes = value.into_bytes();
        let ptr = bytes.as_ptr() as *mut u8;
        std::mem::forget(bytes); // Prevent Rust from freeing the memory
        JSNIValue {
            kind: JSNIKind::String,
            value: (len as u64) << 32 | ptr as u64,
        }
    }
}

impl JSNIValue {
    pub fn null() -> Self {
        JSNIValue {
            kind: JSNIKind::Null,
            value: 0,
        }
    }

    pub fn to_vec(&self) ->Vec<u8> {
        if self.kind != JSNIKind::VecU8 {
            panic!("JSNIValue is not a Vec<u8>");
        }
        let ptr = self.value & 0xFFFFFFFF;
        unsafe { *Box::from_raw(ptr as *mut Vec<u8>) }
    }

    pub fn to_string(&self) -> String {
        if self.kind != JSNIKind::String {
            panic!("JSNIValue is not a String");
        }
        let ptr = self.value & 0xFFFFFFFF;
        let vec = unsafe { *Box::from_raw(ptr as *mut Vec<u8>) };
        String::from_utf8(vec).unwrap()
    }
}

pub struct JavaScriptNativeInterface {
}

#[wasm_bindgen]
extern "C" {
    async fn jsni_call(js_func_name: *const u8, args: *const u8, args_count: usize) -> JsValue;
}

fn vec_onto_box<T>(vec: Vec<T>) -> *mut Vec<T> {
    Box::into_raw(Box::new(vec))
}

/// Allocates a JSNIValue array in the heap and returns a fat pointer.
#[wasm_bindgen]
pub fn alloc_jsni_value(size: usize) -> u64 {
    let mut vec = vec![JSNIValue::null(); size];
    let ptr = vec.as_mut_ptr() as *mut u8;
    let vec_ptr = vec_onto_box(vec);
    (vec_ptr as u64) << 32 | ptr as u64
}

/// Deallocates a JSNIValue array allocated by `alloc_jsni_value.
#[wasm_bindgen]
pub fn alloc(size: usize) -> u64 {
    let mut vec = vec![0u8; size];
    let ptr = vec.as_mut_ptr() as *mut u8;
    let vec_ptr = vec_onto_box(vec);
    (vec_ptr as u64) << 32 | ptr as u64
}

impl JavaScriptNativeInterface {
    pub fn new() -> Self {
        JavaScriptNativeInterface {}
    }

    fn free_args(&self, args: Vec<JSNIValue>) {
        for arg in args {
            match arg.kind {
                JSNIKind::VecU8 => {
                    let len = (arg.value >> 32) as usize;
                    let ptr = (arg.value & 0xFFFFFFFF) as *mut u8;
                    unsafe { Vec::from_raw_parts(ptr, len, len) };
                }
                JSNIKind::String => {
                    let len = (arg.value >> 32) as usize;
                    let ptr = (arg.value & 0xFFFFFFFF) as *mut u8;
                    unsafe { String::from_raw_parts(ptr, len, len) };
                }
                _ => {}
            }
        }
    }

    /// Calls the JavaScript function.
    /// Must be set registers with uarguments to pass to the JavaScript function before calling this function.
    /// Returns a vector of results.
    /// The first register is the count of results, followed by the results themselves.
    pub async fn call(&mut self, js_func_name: String, args: Vec<JSNIValue>) -> Vec<JSNIValue> {
        let js_func_name = JSNIValue::from(js_func_name);
        let js_func_name_ptr = &js_func_name as *const JSNIValue as *const u8;

        let return_values_ptr_raw = jsni_call(js_func_name_ptr, args.as_ptr() as *mut u8, args.len()).await.as_f64().unwrap();
        self.free_args(args);

        if return_values_ptr_raw < 0.0 {
            // none returned
            return Vec::new();
        }

        let return_values = unsafe { Box::from_raw(return_values_ptr_raw as u64 as *mut Vec<JSNIValue>) };
        *return_values
    }
}