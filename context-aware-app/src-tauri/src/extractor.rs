use enigo::{Enigo, Key, Direction, Keyboard, Settings};
use arboard::Clipboard;
use std::{thread, time::Duration};

pub struct Extractor;

impl Extractor {
    pub fn new() -> Self {
        Extractor
    }

    pub fn extract_selection(&self) -> Option<String> {
        println!("Extractor: Starting extraction...");
        let mut enigo = Enigo::new(&Settings::default()).unwrap();
        
        // 1. Simulate Ctrl+C
        #[cfg(target_os = "windows")]
        {
             println!("Extractor: Sending Ctrl+C on Windows");
             let _ = enigo.key(Key::Control, Direction::Press);
             let _ = enigo.key(Key::C, Direction::Click);
             thread::sleep(Duration::from_millis(50));
             let _ = enigo.key(Key::Control, Direction::Release);
        }
        
        #[cfg(target_os = "macos")]
        {
             println!("Extractor: Sending Cmd+C on Mac");
             let _ = enigo.key(Key::Meta, Direction::Press);
             let _ = enigo.key(Key::C, Direction::Click);
             let _ = enigo.key(Key::Meta, Direction::Release);
        }

        // Wait for OS to process copy
        thread::sleep(Duration::from_millis(300));

        // 2. Read Clipboard
        println!("Extractor: Reading clipboard...");
        match Clipboard::new() {
            Ok(mut clipboard) => {
                match clipboard.get_text() {
                    Ok(text) => {
                        println!("Extractor: Captured text: '{}'", text);
                        if text.trim().is_empty() {
                            return None;
                        }
                        return Some(text);
                    },
                    Err(e) => {
                        println!("Extractor: Failed to get text from clipboard: {}", e);
                        return None;
                    }
                }
            },
            Err(e) => {
                 println!("Extractor: Failed to init clipboard: {}", e);
                 return None;
            }
        }
    }

    /// Get the name of the currently active process
    pub fn get_current_process_name(&self) -> String {
        #[cfg(target_os = "windows")]
        {
            use winapi::um::winuser::{GetForegroundWindow, GetWindowThreadProcessId};
            use winapi::um::psapi::GetModuleBaseNameW;
            use winapi::um::handleapi::CloseHandle;
            use winapi::um::processthreadsapi::OpenProcess;
            use std::os::windows::ffi::OsStringExt;
            use std::ffi::OsString;
            
            unsafe {
                let hwnd = GetForegroundWindow();
                if hwnd.is_null() {
                    return String::from("unknown");
                }
                
                let mut process_id: u32 = 0;
                GetWindowThreadProcessId(hwnd, &mut process_id);
                
                let handle = OpenProcess(0x0410, 0, process_id); // PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
                if handle.is_null() {
                    return String::from("unknown");
                }
                
                let mut buffer: [u16; 260] = [0; 260];
                let len = GetModuleBaseNameW(handle, std::ptr::null_mut(), buffer.as_mut_ptr(), 260);
                
                CloseHandle(handle);
                
                if len > 0 {
                    let os_string = OsString::from_wide(&buffer[..len as usize]);
                    os_string.to_string_lossy().to_string()
                } else {
                    String::from("unknown")
                }
            }
        }
        
        #[cfg(target_os = "macos")]
        {
            use cocoa::appkit::{NSWorkspace, NSRunningApplication};
            use cocoa::base::id;
            use objc::runtime::Object;
            
            unsafe {
                let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
                let app: id = msg_send![workspace, frontmostApplication];
                if app.is_null() {
                    return String::from("unknown");
                }
                
                let bundle_url: id = msg_send![app, bundleURL];
                let path: id = msg_send![bundle_url, path];
                let path_str: id = msg_send![path, UTF8String];
                
                if !path_str.is_null() {
                    let c_str = std::ffi::CStr::from_ptr(path_str as *const i8);
                    let path_str = c_str.to_string_lossy().to_string();
                    
                    // Extract just the filename
                    if let Some(filename) = path_str.split('/').last() {
                        filename.to_string()
                    } else {
                        String::from("unknown")
                    }
                } else {
                    String::from("unknown")
                }
            }
        }
        
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            String::from("unknown")
        }
    }
}
