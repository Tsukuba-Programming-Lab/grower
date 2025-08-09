# Grower 
Grower: **G**eneral **R**untime **O**n **WE**b browser**R**s **[Now Development]**

A Library for development language runtimes that run on Web Browsers.

## Install

Now available on [crates.io](https://crates.io/crates/grower).

```sh
cargo add grower
```


## Features

### core::jsni

An implementation of JSNI (JavaScript Native Interface). JSNI is a FFI for a linear-memory between WebAssembly Runtimes and JavaScript Runtimes. You may use this API to call JavaScript functions from Rust. 

For example:

```rust
use grower::core::jsni::*;

let ni = JavaScriptNativeInterface::new();

let return_values: Vec<JSNIValue> = ni.call("hogeFunc".to_string(), vec![
    JSNIValue::from(2 as i8),
    JSNIValue::from(1 as i16),
    JSNIValue::from(1 as i32),
    JSNIValue::from(1 as i64),
    JSNIValue::from(8 as u8),
    JSNIValue::from(16 as u16),
    JSNIValue::from(32 as u32),
    JSNIValue::from(64 as u64),
    JSNIValue::from(0.5 as f32),
    JSNIValue::from(6.4646464 as f64),
    JSNIValue::from("hoge".to_string()),
    JSNIValue::from(vec![1, 2, 3, 4, 5, 6, 7, 8]),
]).await;
```