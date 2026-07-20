#!/usr/bin/env python3
"""Convert the authorized bilingual First Catechism DOCX into the app CSV format."""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

from docx import Document


HEADERS = [
    "item_key",
    "sequence",
    "section",
    "question_zh",
    "question_en",
    "answer_zh",
    "answer_en",
    "scripture_reference",
    "parent_note",
]


def normalize_wrapped_text(value: str) -> str:
    """Remove Word layout wrapping without dropping punctuation or words."""
    lines = [re.sub(r"[\t\u00a0]+", " ", line).strip() for line in value.splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return ""

    merged = lines[0]
    for line in lines[1:]:
        previous = merged[-1:]
        following = line[:1]
        both_chinese = bool(
            re.match(r"[\u3400-\u9fff，。！？；：、“”《》（）]", previous)
            and re.match(r"[\u3400-\u9fff，。！？；：、“”《》（）]", following)
        )
        merged += ("" if both_chinese else " ") + line

    merged = re.sub(r" {2,}", " ", merged)
    merged = re.sub(r"\s+([，。！？；：、,.!?;:)”’])", r"\1", merged)
    merged = re.sub(r"([“‘(])\s+", r"\1", merged)
    merged = re.sub(r"([，。！？；：、]) +(?=[\u3400-\u9fff“])", r"\1", merged)
    return merged.strip()


def parse_entry(number: int, segment: str) -> dict[str, str | int]:
    chinese_prefix = re.match(rf"^\s*{number}。\s*", segment)
    if not chinese_prefix:
        raise ValueError(f"第 {number} 问缺少中文编号")

    english_question = re.search(rf"\b{number}\.\s*Q\.\s*", segment)
    if not english_question:
        raise ValueError(f"第 {number} 问缺少英文问题编号")

    chinese_block = segment[chinese_prefix.end() : english_question.start()]
    answer_marker = re.search(r"答\s*[:：。.]\s*", chinese_block)
    if not answer_marker:
        raise ValueError(f"第 {number} 问缺少中文答案标记")

    question_zh = normalize_wrapped_text(chinese_block[: answer_marker.start()])
    answer_zh = normalize_wrapped_text(chinese_block[answer_marker.end() :])

    english_block = segment[english_question.end() :]
    english_answer = re.search(r"(?:^|\s)A\.\s*", english_block)
    if not english_answer:
        raise ValueError(f"第 {number} 问缺少英文答案标记")

    question_en = normalize_wrapped_text(english_block[: english_answer.start()])
    answer_en = normalize_wrapped_text(english_block[english_answer.end() :])

    values = [question_zh, question_en, answer_zh, answer_en]
    if any(not value for value in values):
        raise ValueError(f"第 {number} 问存在空的问题或答案")

    return {
        "item_key": f"first_catechism_q{number:03d}",
        "sequence": number,
        "section": "",
        "question_zh": question_zh,
        "question_en": question_en,
        "answer_zh": answer_zh,
        "answer_en": answer_en,
        "scripture_reference": "",
        "parent_note": "",
    }


def extract_entries(source: Path) -> list[dict[str, str | int]]:
    document = Document(source)
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    starts = list(re.finditer(r"(?m)^\s*(\d{1,3})。", text))
    if not starts:
        raise ValueError("文档中没有识别到中文问题编号")

    entries: list[dict[str, str | int]] = []
    for index, start in enumerate(starts):
        number = int(start.group(1))
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        entries.append(parse_entry(number, text[start.start() : end]))

    expected = list(range(1, 146))
    actual = [int(entry["sequence"]) for entry in entries]
    if actual != expected:
        raise ValueError(f"问题编号不连续：识别到 {actual}")
    return entries


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    entries = extract_entries(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADERS, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(entries)

    item_82 = entries[81]
    print(f"已生成 {len(entries)} 问：{args.output}")
    print(f"第82问：{item_82['question_zh']}")
    print(f"第82问中文答案：{item_82['answer_zh']}")
    print(f"第82问英文答案：{item_82['answer_en']}")


if __name__ == "__main__":
    main()
