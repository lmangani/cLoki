#![allow(unused_assignments)]
mod utils;

use lazy_static::lazy_static;
use pprof_pb::google::v1::Function;
use pprof_pb::google::v1::Location;
use pprof_pb::google::v1::Profile;
use pprof_pb::querier::v1::FlameGraph;
use pprof_pb::querier::v1::Level;
use pprof_pb::querier::v1::SelectMergeStacktracesResponse;
use prost::Message;
use std::collections::HashMap;
use std::sync::Mutex;
use std::vec::Vec;
use wasm_bindgen::prelude::*;

pub mod pprof_pb {

    pub mod google {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/google.v1.rs"));
        }
    }
    pub mod types {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/types.v1.rs"));
        }
    }
    pub mod querier {
        pub mod v1 {
            include!(concat!(env!("OUT_DIR"), "/querier.v1.rs"));
        }
    }
}

struct TreeNode {
    name_idx: usize,
    prepend: i64,
    total: i64,
    _self: i64,
    children: Vec<TreeNode>,
}

impl TreeNode {
    fn append_child(&mut self, _name_idx: usize) {
        self.children.push(TreeNode {
            name_idx: _name_idx,
            prepend: 0,
            total: 0,
            _self: 0,
            children: Vec::new(),
        });
    }
}

struct Tree {
    names: Vec<String>,
    names_map: HashMap<String, usize>,
    root: TreeNode,
    sample_type: String,
    max_self: i64,
}

unsafe fn merge(tree: &mut Tree, p: &Profile) {
    let mut functions: HashMap<u64, &Function> = HashMap::new();
    for f in p.function.iter() {
        functions.insert(f.id, &f);
    }
    let mut locations: HashMap<u64, &Location> = HashMap::new();
    for l in p.location.iter() {
        locations.insert(l.id, &l);
    }

    let mut value_idx: i32 = -1;
    for i in 0..p.sample_type.len() {
        let sample_type = format!(
            "{}:{}",
            p.string_table[p.sample_type[i].r#type as usize],
            p.string_table[p.sample_type[i].unit as usize]
        );
        if tree.sample_type == sample_type {
            value_idx = i as i32;
            break;
        }
    }

    if value_idx == -1 {
        return;
    }
    for i in 0..p.location.len() {
        let l = &p.location[i];
        let line = &p.string_table[functions[&l.line[0].function_id].name as usize];
        if tree.names_map.contains_key(line) {
            continue;
        }
        tree.names.push(line.clone());
        tree.names_map.insert(line.clone(), tree.names.len() - 1);
    }

    for s in p.sample.iter() {
        let mut node = &mut tree.root;
        for i in (0..s.location_id.len()).rev() {
            let location = locations[&s.location_id[i]];
            let name_idx = tree.names_map
                [&p.string_table[functions[&location.line[0].function_id].name as usize]];
            let mut node_idx: i32 = -1;
            for j in 0..node.children.len() {
                if node.children[j].name_idx == name_idx {
                    node_idx = j as i32;
                    break;
                }
            }
            if node_idx == -1 {
                node.append_child(name_idx);
                node_idx = (node.children.len() as i32) - 1;
            }
            node = &mut node.children[node_idx as usize];
            node.total += s.value[value_idx as usize];
            if i == 0 {
                node._self += s.value[value_idx as usize];
                if node._self > tree.max_self {
                    tree.max_self = node._self
                }
            }
        }
    }
    tree.root.total = 0;
    for c in tree.root.children.iter() {
        tree.root.total += c.total;
    }
}

/*fn read_uleb128(bytes: &[u8]) -> (usize, usize) {
    let mut result = 0;
    let mut shift = 0;
    loop {
        let byte = bytes[shift];
        result |= ((byte & 0x7f) as usize) << (shift * 7);
        shift += 1;
        if byte & 0x80 == 0 {
            break;
        }
    }
    (result, shift)
}*/

static mut INTS: [i64; 4000000] = [0; 4000000];

unsafe fn bfs(t: &mut Tree, res: &mut Vec<&[i64]>) {
    let mut valid_refs = true;
    // suppress irrelevant warnings
    let mut prepend: i64 = 0;
    let mut k = 4;
    INTS[0] = 0;
    INTS[1] = t.root.total;
    INTS[2] = t.root._self;
    INTS[3] = t.root.name_idx as i64;
    res.push(&INTS[0..4]);
    let mut refs: Vec<*mut TreeNode> = vec![&mut t.root];
    let mut _refs: Vec<*mut TreeNode> = vec![];
    while valid_refs {
        valid_refs = false;
        prepend = 0;
        let _k = k;
        for i in 0..refs.len() {
            let _ref = refs[i];
            prepend += (*_ref).prepend;
            for j in 0..(*_ref).children.len() {
                valid_refs = true;
                (*_ref).children[j].prepend += prepend;
                INTS[k] = (*_ref).children[j].prepend;
                INTS[k + 1] = (*_ref).children[j].total;
                INTS[k + 2] = (*_ref).children[j]._self;
                INTS[k + 3] = (*_ref).children[j].name_idx as i64;
                prepend = 0;
                _refs.push(&mut (*_ref).children[j]);

                k += 4;
            }
            if (*_ref).children.len() == 0 {
                prepend += (*_ref).total;
            } else {
                prepend += (*_ref)._self
            }
        }
        res.push(&INTS[_k..k]);
        std::mem::swap(&mut refs, &mut _refs);
        _refs.clear();
    }
}

lazy_static! {
    static ref CTX: Mutex<HashMap<u32, Tree>> = Mutex::new(HashMap::new());
}

#[wasm_bindgen]
pub unsafe fn merge_tree(id: u32, bytes: &[u8], sample_type: String) {
    let mut ctx = CTX.lock().unwrap();
    if !ctx.contains_key(&id) {
        ctx.insert(
            id,
            Tree {
                names: Vec::new(),
                names_map: HashMap::new(),
                root: TreeNode {
                    name_idx: 0,
                    _self: 0,
                    children: vec![],
                    prepend: 0,
                    total: 0,
                },
                sample_type,
                max_self: 0,
            },
        );
    }

    let mut tree = ctx.get_mut(&id).unwrap();
    tree.names.push("total".to_string());
    tree.names_map.insert("total".to_string(), 0);

    let prof = Profile::decode(bytes).unwrap();
    merge(&mut tree, &prof);
}

#[wasm_bindgen]
pub unsafe fn export_tree(id: u32) -> Vec<u8> {
    let mut ctx = CTX.lock().unwrap();
    let mut res = SelectMergeStacktracesResponse::default();
    if !ctx.contains_key(&id) {
        return res.encode_to_vec();
    }
    let tree = (*ctx).get_mut(&id).unwrap();
    let mut fg = FlameGraph::default();
    fg.names = tree.names.clone();
    let mut levels: Vec<&[i64]> = Vec::new();
    bfs(tree, &mut levels);
    for l in levels {
        let mut level = Level::default();
        for v in l.iter() {
            level.values.push(*v);
        }
        fg.levels.push(level);
    }
    fg.total = tree.root.total;
    fg.max_self = tree.max_self;
    res.flamegraph = Some(fg);
    res.encode_to_vec()
}

#[wasm_bindgen]
pub unsafe fn drop_tree(id: u32) {
    let mut ctx = CTX.lock().unwrap();
    if ctx.contains_key(&id) {
        ctx.remove(&id);
    }
}

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}
