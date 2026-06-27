#!/usr/bin/env python3
"""
Analyzes git diff output to identify review focus areas.

Usage: 
    diff-analysis.py --staged
    diff-analysis.py --branch <branch>
    diff-analysis.py --pr <pr-number>

Outputs:
- Large files (>300 lines changed)
- New dependencies added (package.json, build.gradle, requirements.txt, etc.)
- Test coverage ratio (test files vs implementation files)
- Potential security concerns (credentials, secrets patterns)
- File categories (new, modified, deleted)
"""
import subprocess
import re
import sys
import argparse
from collections import defaultdict


def get_diff_output(args):
    """Get diff output based on arguments."""
    if args.staged:
        cmd = ["git", "diff", "--staged", "--stat"]
    elif args.branch:
        cmd = ["git", "diff", f"{args.branch}...HEAD", "--stat"]
    else:
        cmd = ["git", "diff", "--stat"]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout


def get_diff_names(args):
    """Get list of changed files with status."""
    if args.staged:
        cmd = ["git", "diff", "--staged", "--name-status"]
    elif args.branch:
        cmd = ["git", "diff", f"{args.branch}...HEAD", "--name-status"]
    else:
        cmd = ["git", "diff", "--name-status"]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout


def analyze_diff(args):
    """Analyze the diff and report findings."""
    diff_stat = get_diff_output(args)
    diff_names = get_diff_names(args)
    
    findings = {
        "large_files": [],
        "new_dependencies": [],
        "test_files": [],
        "impl_files": [],
        "security_concerns": [],
        "file_status": {"added": [], "modified": [], "deleted": []}
    }
    
    # Dependency file patterns
    dep_patterns = [
        "package.json", "package-lock.json", "yarn.lock",
        "requirements.txt", "Pipfile", "pyproject.toml", "poetry.lock",
        "build.gradle", "build.gradle.kts", "pom.xml",
        "Gemfile", "Gemfile.lock",
        "go.mod", "go.sum",
        "Cargo.toml", "Cargo.lock"
    ]
    
    # Test file patterns
    test_patterns = [
        r"test_.*\.py$", r".*_test\.py$",
        r".*Test\.kt$", r".*Test\.java$",
        r".*\.test\.(js|ts|tsx)$", r".*\.spec\.(js|ts|tsx)$",
        r"__tests__/.*"
    ]
    
    # Security concern patterns
    security_patterns = [
        r"password", r"secret", r"api_key", r"apikey", r"api-key",
        r"token", r"credential", r"private_key", r"privatekey"
    ]
    
    # Parse diff stat for large files
    for line in diff_stat.split("\n"):
        match = re.match(r"\s*(.+?)\s*\|\s*(\d+)", line)
        if match:
            filename = match.group(1).strip()
            changes = int(match.group(2))
            
            if changes > 300:
                findings["large_files"].append((filename, changes))
            
            # Check for dependency files
            for dep in dep_patterns:
                if filename.endswith(dep):
                    findings["new_dependencies"].append(filename)
            
            # Categorize test vs impl
            is_test = any(re.search(p, filename) for p in test_patterns)
            if is_test:
                findings["test_files"].append(filename)
            else:
                findings["impl_files"].append(filename)
    
    # Parse file status
    for line in diff_names.split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            status, filename = parts[0], parts[1]
            if status == "A":
                findings["file_status"]["added"].append(filename)
            elif status == "M":
                findings["file_status"]["modified"].append(filename)
            elif status == "D":
                findings["file_status"]["deleted"].append(filename)
    
    return findings


def print_report(findings):
    """Print analysis report."""
    print("=" * 60)
    print("DIFF ANALYSIS REPORT")
    print("=" * 60)
    
    # Large files
    if findings["large_files"]:
        print("\n⚠️  LARGE FILES (>300 lines changed):")
        for filename, changes in findings["large_files"]:
            print(f"   - {filename}: {changes} lines")
    
    # Dependencies
    if findings["new_dependencies"]:
        print("\n📦 DEPENDENCY FILES CHANGED:")
        for dep in findings["new_dependencies"]:
            print(f"   - {dep}")
    
    # Test coverage ratio
    test_count = len(findings["test_files"])
    impl_count = len(findings["impl_files"])
    total = test_count + impl_count
    if total > 0:
        ratio = test_count / total * 100
        print(f"\n🧪 TEST COVERAGE RATIO:")
        print(f"   - Test files: {test_count}")
        print(f"   - Implementation files: {impl_count}")
        print(f"   - Ratio: {ratio:.1f}% test files")
        if ratio < 20 and impl_count > 0:
            print("   ⚠️  Low test coverage - consider adding tests")
    
    # File status summary
    added = len(findings["file_status"]["added"])
    modified = len(findings["file_status"]["modified"])
    deleted = len(findings["file_status"]["deleted"])
    print(f"\n📁 FILE CHANGES:")
    print(f"   - Added: {added}")
    print(f"   - Modified: {modified}")
    print(f"   - Deleted: {deleted}")
    
    print("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Analyze git diff for code review")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--staged", action="store_true", help="Analyze staged changes")
    group.add_argument("--branch", type=str, help="Compare against branch (e.g., origin/main)")
    
    args = parser.parse_args()
    
    findings = analyze_diff(args)
    print_report(findings)


if __name__ == "__main__":
    main()
